#!/usr/bin/env node
/**
 * One public port for ngrok: relay paths → :8787, everything else → QR site :3100.
 * Pilot-only; not for production.
 */
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';

const GATE = Number(process.env.PILOT_GATE_PORT ?? 9080);
const RELAY = Number(process.env.PILOT_RELAY_PORT ?? 8787);
const SITE = Number(process.env.PILOT_SITE_PORT ?? 3100);

function relayPath(pathname) {
  return (
    pathname === '/healthz' ||
    pathname.startsWith('/functions/v1') ||
    pathname.startsWith('/realtime/v1') ||
    pathname.startsWith('/storage/v1')
  );
}

function proxyHttp(incoming, outgoing, port) {
  const headers = { ...incoming.headers, host: `127.0.0.1:${port}` };
  const upstream = httpRequest(
    {
      hostname: '127.0.0.1',
      port,
      path: incoming.url,
      method: incoming.method,
      headers,
    },
    (res) => {
      outgoing.writeHead(res.statusCode ?? 502, res.headers);
      res.pipe(outgoing);
    },
  );
  upstream.on('error', () => {
    if (!outgoing.headersSent) outgoing.writeHead(502).end('Bad gateway');
  });
  incoming.pipe(upstream);
}

function proxyUpgrade(incoming, socket, head, port) {
  const proxy = netConnect(port, '127.0.0.1', () => {
    let raw = `${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}\r\n`;
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (value !== undefined)
        raw += `${key}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`;
    }
    raw += '\r\n';
    proxy.write(raw);
    if (head.length > 0) proxy.write(head);
    socket.pipe(proxy).pipe(socket);
  });
  proxy.on('error', () => socket.destroy());
  socket.on('error', () => proxy.destroy());
}

createServer((incoming, outgoing) => {
  const pathname = (incoming.url ?? '/').split('?')[0];
  proxyHttp(incoming, outgoing, relayPath(pathname) ? RELAY : SITE);
})
  .on('upgrade', (incoming, socket, head) => {
    const pathname = (incoming.url ?? '/').split('?')[0];
    proxyUpgrade(incoming, socket, head, relayPath(pathname) ? RELAY : SITE);
  })
  .listen(GATE, '127.0.0.1', () => {
    process.stdout.write(`ngrok gateway on http://127.0.0.1:${GATE}\n`);
  });
