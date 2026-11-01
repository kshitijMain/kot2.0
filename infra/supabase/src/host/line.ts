import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import pg from 'pg';
import { type WebSocket, WebSocketServer } from 'ws';

/**
 * The restaurant's open line on a self-hosted relay (P9-01, ADR-0024): each local server keeps one
 * WebSocket open here, and a new QR order or service request rings it within milliseconds, so it
 * never has to keep asking. It speaks the part of Supabase Realtime's Phoenix protocol (1.0.0,
 * JSON) the local server already uses (P5-03d, `RelayRealtime`): the socket at
 * `/realtime/v1/websocket`, a join with the token `server/session` signs (HS256, not expired),
 * heartbeats, token refresh, and INSERTs on the relay's queues, delivered after commit only to the
 * restaurant the token names (as RLS for `relay_server` does on Supabase).
 *
 * Kept light on both ends: an idle line costs a few KB here and one small heartbeat every 25 s from
 * the restaurant. Rings come from `pg_notify('relay_ring')` (migration 20261031100000) on one
 * listening connection, whatever the number of restaurants. Lines that stop answering pings are
 * dropped, so a PC that lost power does not hold memory.
 */

export const RING_CHANNEL = 'relay_ring';
export const LINE_PATH = '/realtime/v1/websocket';

/** What the ring trigger reports: enough to route it, not the whole row. */
interface Change {
  readonly schema: string;
  readonly table: string;
  readonly type: string;
  readonly record: { readonly id: string; readonly tenant_id: string } & Record<string, unknown>;
}

interface Binding {
  readonly id: number;
  readonly event: string;
  readonly schema: string;
  readonly table: string;
  readonly filter?: string;
}

interface Joined {
  readonly topic: string;
  readonly bindings: readonly Binding[];
  tenantId: string;
  expiresAt: number;
}

interface Message {
  readonly topic: string;
  readonly event: string;
  readonly payload: Record<string, unknown>;
  readonly ref: string | null;
  readonly join_ref?: string | null;
}

const recordOf = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
const stringOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A message a socket sent, in Phoenix's shape, or undefined when it is not one. */
function messageOf(value: unknown): Message | undefined {
  const given = recordOf(value);
  if (typeof given.topic !== 'string' || typeof given.event !== 'string') return undefined;
  return {
    topic: given.topic,
    event: given.event,
    payload: recordOf(given.payload),
    ref: typeof given.ref === 'string' ? given.ref : null,
    join_ref: typeof given.join_ref === 'string' ? given.join_ref : null,
  };
}

export interface Line {
  /** Hands an HTTP upgrade at the line's path to it; false for any other path. */
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  /** Sockets with at least one joined channel: the restaurants listening now. */
  readonly subscribers: number;
  /** Drops every socket (tests: an internet cut). */
  dropAll(): void;
  close(): Promise<void>;
}

export interface LineOptions {
  /** A connection that may LISTEN; any login of the relay's database. */
  readonly databaseUrl: string;
  /** The secret `server/session` signs tokens with (`RELAY_JWT_SECRET`). */
  readonly jwtSecret: string;
  /** The public key the socket asks for (`RELAY_REALTIME_API_KEY`), as Supabase's does. */
  readonly apiKey: string;
  /** How often to ping each socket; one that has not answered the last ping is dropped. */
  readonly pingMs?: number;
  /** After the listening connection fails, try again this much later. */
  readonly relistenMs?: number;
  readonly log?: (message: string) => void;
}

/** A local server joins one channel; a few more are allowed, never an unbounded number. */
const MAX_TOPICS_PER_SOCKET = 4;
const MAX_BINDINGS_PER_TOPIC = 8;
/** Phoenix messages here are small; anything larger is not a local server. */
const MAX_MESSAGE_BYTES = 16 * 1024;

/** The claims of an HS256 token signed with `secret`, or why it is refused. */
export function verifyToken(token: unknown, secret: string): Record<string, unknown> | string {
  if (typeof token !== 'string') return 'No access token';
  const [header, payload, signature] = token.split('.');
  if (header === undefined || payload === undefined || signature === undefined) {
    return 'Invalid JWT';
  }
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return 'Invalid JWT signature';
  }
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return 'Invalid JWT';
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return 'Token has expired';
  if (claims.role !== 'relay_server' || typeof claims.tenant_id !== 'string') {
    return 'Not a relay server token';
  }
  return claims;
}

const textOf = (data: unknown): string =>
  Array.isArray(data)
    ? Buffer.concat(data as Buffer[]).toString('utf8')
    : Buffer.isBuffer(data)
      ? data.toString('utf8')
      : Buffer.from(new Uint8Array(data as ArrayBuffer)).toString('utf8');

export async function startLine(options: LineOptions): Promise<Line> {
  const log = options.log ?? (() => undefined);
  const sockets = new Map<WebSocket, Map<string, Joined>>();
  const alive = new WeakSet<WebSocket>();
  const server = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  let nextBindingId = 1000;
  let closed = false;

  const send = (socket: WebSocket, message: Message) => {
    socket.send(JSON.stringify(message));
  };
  const reply = (socket: WebSocket, message: Message, status: 'ok' | 'error', response: object) => {
    send(socket, {
      topic: message.topic,
      event: 'phx_reply',
      payload: { status, response },
      ref: message.ref,
      join_ref: message.join_ref ?? null,
    });
  };

  const onMessage = (socket: WebSocket, joined: Map<string, Joined>, message: Message) => {
    if (message.topic === 'phoenix' && message.event === 'heartbeat') {
      reply(socket, message, 'ok', {});
      return;
    }
    if (message.event === 'phx_join') {
      const claims = verifyToken(message.payload.access_token, options.jwtSecret);
      if (typeof claims === 'string') {
        reply(socket, message, 'error', { reason: claims });
        return;
      }
      if (!joined.has(message.topic) && joined.size >= MAX_TOPICS_PER_SOCKET) {
        reply(socket, message, 'error', { reason: 'Too many channels' });
        return;
      }
      const wanted = recordOf(message.payload.config).postgres_changes;
      const bindings = (Array.isArray(wanted) ? wanted.slice(0, MAX_BINDINGS_PER_TOPIC) : []).map(
        (binding: unknown): Binding => {
          const given = recordOf(binding);
          return {
            id: nextBindingId++,
            event: stringOf(given.event),
            schema: stringOf(given.schema),
            table: stringOf(given.table),
            ...(typeof given.filter === 'string' && { filter: given.filter }),
          };
        },
      );
      joined.set(message.topic, {
        topic: message.topic,
        bindings,
        tenantId: claims.tenant_id as string,
        expiresAt: Number(claims.exp) * 1000,
      });
      reply(socket, message, 'ok', { postgres_changes: bindings });
      send(socket, {
        topic: message.topic,
        event: 'system',
        payload: {
          channel: message.topic.replace(/^realtime:/, ''),
          extension: 'postgres_changes',
          message: 'Subscribed to PostgreSQL',
          status: 'ok',
        },
        ref: null,
      });
      return;
    }
    const channel = joined.get(message.topic);
    if (channel === undefined) return;
    if (message.event === 'access_token') {
      const claims = verifyToken(message.payload.access_token, options.jwtSecret);
      // A renewed token never moves a channel to another restaurant.
      if (typeof claims === 'string' || claims.tenant_id !== channel.tenantId) return;
      channel.expiresAt = Number(claims.exp) * 1000;
      return;
    }
    if (message.event === 'phx_leave') {
      joined.delete(message.topic);
      reply(socket, message, 'ok', {});
    }
  };

  server.on('connection', (socket: WebSocket) => {
    const joined = new Map<string, Joined>();
    sockets.set(socket, joined);
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));
    socket.on('message', (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(textOf(data));
      } catch {
        socket.close(1003, 'Not JSON');
        return;
      }
      const message = messageOf(parsed);
      if (message !== undefined) onMessage(socket, joined, message);
    });
    socket.on('error', () => {
      socket.terminate();
    });
    socket.on('close', () => sockets.delete(socket));
  });

  /** Rings every joined channel of the change's restaurant that listens for it. */
  const deliver = (change: Change) => {
    for (const [socket, joined] of sockets) {
      for (const channel of joined.values()) {
        if (channel.expiresAt <= Date.now()) {
          // As Supabase does, a channel whose token ran out is closed; the server joins again.
          joined.delete(channel.topic);
          send(socket, {
            topic: channel.topic,
            event: 'system',
            payload: { extension: 'system', message: 'Token has expired', status: 'error' },
            ref: null,
          });
          send(socket, { topic: channel.topic, event: 'phx_close', payload: {}, ref: null });
          continue;
        }
        if (change.record.tenant_id !== channel.tenantId) continue;
        const ids = channel.bindings
          .filter(
            (binding) =>
              (binding.event === '*' || binding.event === change.type) &&
              binding.schema === change.schema &&
              binding.table === change.table &&
              (binding.filter === undefined ||
                binding.filter === `tenant_id=eq.${change.record.tenant_id}`),
          )
          .map((binding) => binding.id);
        if (ids.length === 0) continue;
        send(socket, {
          topic: channel.topic,
          event: 'postgres_changes',
          payload: {
            ids,
            data: {
              schema: change.schema,
              table: change.table,
              type: change.type,
              commit_timestamp: new Date().toISOString(),
              record: change.record,
              columns: [],
              errors: null,
            },
          },
          ref: null,
        });
      }
    }
  };

  // One listening connection for every restaurant. If it fails, the local servers' safety-net
  // polling still finds every order; listening starts again shortly.
  let listener: pg.Client | undefined;
  let relisten: NodeJS.Timeout | undefined;
  const listen = async (): Promise<void> => {
    const client = new pg.Client({ connectionString: options.databaseUrl });
    client.on('notification', (notification) => {
      if (notification.channel !== RING_CHANNEL || notification.payload === undefined) return;
      try {
        deliver(JSON.parse(notification.payload) as Change);
      } catch {
        // Not a ring this host understands.
      }
    });
    client.on('error', (error: Error) => {
      log(`line: listening connection failed: ${error.message}`);
      void client.end().catch(() => undefined);
      if (listener === client) listener = undefined;
      if (!closed) {
        relisten = setTimeout(() => {
          void listen().catch(() => undefined);
        }, options.relistenMs ?? 5_000);
      }
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${RING_CHANNEL}`);
    } catch (error) {
      await client.end().catch(() => undefined);
      if (closed) return;
      log(`line: could not listen: ${error instanceof Error ? error.message : String(error)}`);
      relisten = setTimeout(() => {
        void listen().catch(() => undefined);
      }, options.relistenMs ?? 5_000);
      return;
    }
    listener = client;
  };
  await listen();

  const pinger = setInterval(() => {
    for (const socket of sockets.keys()) {
      if (!alive.has(socket)) {
        socket.terminate();
        continue;
      }
      alive.delete(socket);
      socket.ping();
    }
  }, options.pingMs ?? 30_000);
  pinger.unref();

  return {
    upgrade(request, socket, head) {
      const url = new URL(request.url ?? '/', 'http://relay.invalid');
      if (url.pathname !== LINE_PATH) return false;
      const given = Buffer.from(url.searchParams.get('apikey') ?? '');
      const expected = Buffer.from(options.apiKey);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
        return true;
      }
      server.handleUpgrade(request, socket, head, (ws) => {
        server.emit('connection', ws, request);
      });
      return true;
    },
    get subscribers() {
      return [...sockets.values()].filter((joined) => joined.size > 0).length;
    },
    dropAll() {
      for (const socket of sockets.keys()) socket.terminate();
    },
    async close() {
      closed = true;
      clearInterval(pinger);
      if (relisten !== undefined) clearTimeout(relisten);
      for (const socket of sockets.keys()) socket.terminate();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      await listener?.end().catch(() => undefined);
    },
  };
}
