import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FunctionContext, Handler } from '../http.js';

/** Every function, as Supabase serves them under `/functions/v1/<name>`. */
export const FUNCTION_PATH = /^\/functions\/v1\/([a-z-]+)(?:\/|$)/;

/**
 * More than any function takes (8 MB for a menu, P8-03b4b); a body over it is refused before it
 * is held in memory. Each function still applies its own, smaller cap.
 */
export const MAX_BODY_BYTES = 9 * 1024 * 1024;

/**
 * Serves `functions` over Node's HTTP server the way Supabase does: `/functions/v1/<name>/...`,
 * a Fetch API `Request` in and `Response` out (ADR-0015, ADR-0024).
 */
export function nodeListener(
  functions: Readonly<Record<string, Handler>>,
  context: FunctionContext,
  options: { readonly maxBodyBytes?: number } = {},
): (request: IncomingMessage, response: ServerResponse) => void {
  const cap = options.maxBodyBytes ?? MAX_BODY_BYTES;
  return (incoming, outgoing) => {
    void (async () => {
      const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');
      const name = FUNCTION_PATH.exec(url.pathname)?.[1];
      const handler = name === undefined ? undefined : functions[name];
      if (handler === undefined) {
        outgoing.writeHead(404).end();
        return;
      }
      if (Number(incoming.headers['content-length'] ?? 0) > cap) {
        outgoing.writeHead(413, { connection: 'close' }).end();
        incoming.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += (chunk as Buffer).length;
        if (size > cap) {
          outgoing.writeHead(413, { connection: 'close' }).end();
          incoming.destroy();
          return;
        }
        chunks.push(chunk as Buffer);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) for (const item of value) headers.append(key, item);
      }
      const method = incoming.method ?? 'GET';
      const response = await handler(
        new Request(url, {
          method,
          headers,
          ...(method !== 'GET' && method !== 'HEAD' && { body: Buffer.concat(chunks) }),
        }),
        context,
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    })().catch(() => {
      if (!outgoing.headersSent) outgoing.writeHead(500).end();
      else outgoing.destroy();
    });
  };
}
