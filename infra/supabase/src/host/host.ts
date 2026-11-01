import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import pg from 'pg';
import type { FunctionContext, PhotoStorage } from '../http.js';
import type { HostConfig } from './config.js';
import { pgRelayDatabase } from './database.js';
import { FUNCTIONS } from './functions.js';
import { type Jobs, startJobs } from './jobs.js';
import { type Line, startLine } from './line.js';
import { nodeListener } from './listener.js';
import { diskPhotoStorage, PHOTO_PATH, servePhoto } from './photos.js';

/**
 * The QR relay on a server of your own (P9-01, ADR-0024): the same functions Supabase would run
 * (ADR-0015), one Node process, one PostgreSQL. It serves:
 *
 * - `/functions/v1/<name>`: the diners' and the local servers' functions;
 * - `/realtime/v1/websocket`: each restaurant's open line, rung by every new QR order or request;
 * - `/storage/v1/object/public/menu-photos/...`: menu photos from its own disk;
 * - `/healthz`: whether it is up, and how many restaurants are on the line.
 *
 * Many restaurants share one host: every row is scoped to its restaurant by Row-Level Security,
 * an idle line costs a few KB, and one database connection listens for every restaurant's rings.
 */
export interface RelayHost {
  readonly port: number;
  readonly line: Line | undefined;
  readonly jobs: Jobs | undefined;
  close(): Promise<void>;
}

export async function startHost(
  config: HostConfig,
  log: (message: string) => void = () => undefined,
): Promise<RelayHost> {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.poolSize });
  pool.on('error', (error) => {
    log(`database: ${error.message}`);
  });
  const photos: PhotoStorage | undefined =
    config.photosDir === undefined
      ? undefined
      : diskPhotoStorage(config.photosDir, `${config.publicUrl}${PHOTO_PATH.replace(/\/$/, '')}`);
  const context: FunctionContext = {
    db: pgRelayDatabase(pool),
    now: () => new Date(),
    allowedOrigins: config.allowedOrigins,
    realtimeJwtSecret: config.jwtSecret,
    realtimeApiKey: config.apiKey,
    photos,
  };
  const line =
    config.jwtSecret === undefined || config.apiKey === undefined
      ? undefined
      : await startLine({
          databaseUrl: config.databaseUrl,
          jwtSecret: config.jwtSecret,
          apiKey: config.apiKey,
          log,
        });
  const jobs =
    config.jobsDatabaseUrl === undefined
      ? undefined
      : startJobs({ databaseUrl: config.jobsDatabaseUrl, log });
  void jobs?.runNow();
  const functions = nodeListener(FUNCTIONS, context);

  const http: Server = createServer((incoming, outgoing) => {
    const path = (incoming.url ?? '/').split('?')[0];
    if (path === '/healthz') {
      outgoing
        .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ ok: true, restaurantsOnLine: line?.subscribers ?? 0 }));
      return;
    }
    if (config.photosDir !== undefined && servePhoto(config.photosDir, incoming, outgoing)) return;
    functions(incoming, outgoing);
  });
  // Diners' requests are short; a slow one is cut off. The line's sockets are upgraded and are
  // not subject to these.
  http.requestTimeout = 30_000;
  http.headersTimeout = 15_000;
  http.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (line?.upgrade(request, socket, head) !== true) socket.destroy();
  });
  await new Promise<void>((resolve) => http.listen(config.port, config.host, resolve));
  const address = http.address();
  const port = typeof address === 'object' && address !== null ? address.port : config.port;
  log(
    `relay host listening on ${config.host}:${String(port)}` +
      (line === undefined
        ? ' (no open line: RELAY_JWT_SECRET or RELAY_REALTIME_API_KEY unset)'
        : ''),
  );

  return {
    port,
    line,
    jobs,
    async close() {
      await line?.close();
      http.closeAllConnections();
      await new Promise<void>((resolve) => {
        http.close(() => {
          resolve();
        });
      });
      await jobs?.stop();
      await pool.end();
    },
  };
}
