#!/usr/bin/env node
// A virtual thermal printer for development (never shipped to restaurants): it listens like a
// network printer on raw TCP (port 9100 by default), takes the ESC/POS bytes the server sends
// (apps/server/src/printing/escpos.ts) and shows each ticket in the browser as an 80 mm or 58 mm
// receipt, newest first.
//
// Usage:
//   pnpm printer:virtual                         printer on 127.0.0.1:9100, page on :9180
//   pnpm printer:virtual -- --port 9101 --http-port 9181 --paper 58 --host 0.0.0.0
//
// --paper 58|80 draws every ticket on that paper; by default each ticket's widest line decides.
// --host 0.0.0.0 lets a server on another machine print here (the page stays on 127.0.0.1).
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { parseArgs } from 'node:util';
import { paperWidthOf, parseEscPos } from './escpos-parser.mjs';

const { values: options } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.VIRTUAL_PRINTER_PORT ?? '9100' },
    host: { type: 'string', default: '127.0.0.1' },
    'http-port': { type: 'string', default: process.env.VIRTUAL_PRINTER_HTTP_PORT ?? '9180' },
    paper: { type: 'string', default: 'auto' },
    keep: { type: 'string', default: '200' },
  },
});
const port = Number(options.port);
const httpPort = Number(options['http-port']);
const forcedPaper = options.paper === '58' ? 58 : options.paper === '80' ? 80 : undefined;
const keep = Math.max(1, Number(options.keep) || 200);

/** Jobs received, newest first. */
const jobs = [];
let nextId = 1;
/** Pages waiting to hear about new jobs (server-sent events). */
const listeners = new Set();

function received(bytes, from) {
  if (bytes.length === 0) return; // a connection that sent nothing (a scan of port 9100)
  const parsed = parseEscPos(bytes);
  const job = {
    id: nextId++,
    receivedAt: new Date().toISOString(),
    from,
    bytes: bytes.length,
    paper: paperWidthOf(parsed, forcedPaper),
    ...parsed,
  };
  jobs.unshift(job);
  jobs.length = Math.min(jobs.length, keep);
  const firstLine = job.receipts[0]?.lines
    .map((line) => line.runs.map((run) => run.text).join(''))
    .find((text) => text.trim() !== '');
  console.log(
    `#${job.id} ${job.bytes} bytes from ${from}, ${job.paper} mm, ${job.receipts.length} receipt(s): ${firstLine ?? ''}`,
  );
  for (const response of listeners) response.write(`data: ${job.id}\n\n`);
}

createTcpServer((socket) => {
  const chunks = [];
  const from = `${socket.remoteAddress ?? '?'}:${socket.remotePort ?? '?'}`;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    received(Buffer.concat(chunks), from);
  };
  socket.on('data', (chunk) => chunks.push(chunk));
  // The server ends the connection when the job is sent; some drivers just close it.
  socket.on('end', finish);
  socket.on('close', finish);
  socket.on('error', () => undefined);
})
  .on('error', (error) => {
    console.error(`The printer port ${port} cannot be used: ${error.message}`);
    process.exit(1);
  })
  .listen(port, options.host, () => {
    console.log(`Virtual printer: add a network printer at ${options.host}:${port}`);
  });

createHttpServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${httpPort}`);
  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'",
    });
    response.end(PAGE);
  } else if (request.method === 'GET' && url.pathname === '/page.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end(SCRIPT);
  } else if (request.method === 'GET' && url.pathname === '/page.css') {
    response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    response.end(STYLE);
  } else if (request.method === 'GET' && url.pathname === '/jobs.json') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(jobs));
  } else if (request.method === 'GET' && url.pathname === '/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    response.write(': connected\n\n');
    listeners.add(response);
    request.on('close', () => listeners.delete(response));
  } else if (request.method === 'POST' && url.pathname === '/clear') {
    jobs.length = 0;
    for (const listener of listeners) listener.write('data: cleared\n\n');
    response.writeHead(204).end();
  } else {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
})
  .on('error', (error) => {
    console.error(`The page port ${httpPort} cannot be used: ${error.message}`);
    process.exit(1);
  })
  .listen(httpPort, '127.0.0.1', () => {
    console.log(`Tickets appear at http://127.0.0.1:${httpPort}`);
  });

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Virtual printer</title>
<link rel="stylesheet" href="/page.css">
<script src="/page.js" defer></script>
</head>
<body>
<header>
  <h1>Virtual printer</h1>
  <p id="status">Waiting for tickets on port ${port}…</p>
  <button type="button" id="clear">Clear</button>
</header>
<main id="jobs" aria-live="polite"></main>
</body>
</html>`;

const STYLE = `
:root { color-scheme: light; --paper: #fffdf7; --ink: #1c1b19; --muted: #6b6760; --bg: #e9e6df; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.4 system-ui, sans-serif; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; padding: 16px 24px;
  background: #fff; border-bottom: 1px solid #d6d2c9; position: sticky; top: 0; z-index: 1; }
h1 { margin: 0; font-size: 20px; }
#status { margin: 0; color: var(--muted); flex: 1; }
button { font: inherit; padding: 8px 16px; border: 1px solid #b9b4aa; border-radius: 8px;
  background: #fff; cursor: pointer; min-height: 44px; }
button:focus-visible { outline: 3px solid #1f6feb; outline-offset: 2px; }
main { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 32px; padding: 24px; }
.job { display: flex; flex-direction: column; gap: 8px; }
.job__meta { margin: 0; color: var(--muted); font-size: 13px; }
.job__note { margin: 0; font-size: 13px; font-weight: 600; }
.receipt { --cols: 48; width: calc(var(--cols) * 1ch + 32px); padding: 20px 16px 8px;
  background: var(--paper); box-shadow: 0 1px 3px rgb(0 0 0 / 0.18);
  font: 13px/1.5 ui-monospace, "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace; }
.receipt--58 { --cols: 32; }
.line { white-space: pre; min-height: 1.5em; }
.line--centre { text-align: center; }
.line--right { text-align: right; }
.run--bold { font-weight: 700; }
.run--underline { text-decoration: underline; }
.run--sized { display: inline-block; vertical-align: bottom; text-align: left; }
.run__text { display: inline-block; line-height: 1.5; transform-origin: left center; }
.cut { margin: 12px -16px -8px; border-top: 2px dashed #9a958b; position: relative; height: 12px; }
.cut::after { content: "✂ cut"; position: absolute; top: -11px; right: 8px; padding: 0 4px;
  background: var(--bg); color: var(--muted); font: 12px system-ui, sans-serif; }
.torn { margin: 12px -16px -8px; height: 8px;
  background: linear-gradient(-45deg, var(--bg) 4px, transparent 0) 0 0 / 8px 8px repeat-x,
              linear-gradient(45deg, var(--bg) 4px, transparent 0) 0 0 / 8px 8px repeat-x; }
.empty { color: var(--muted); }
`;

// The page builds every ticket with textContent, never HTML from the bytes.
const SCRIPT = `
const list = document.getElementById('jobs');
const status = document.getElementById('status');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function runNode(run) {
  const span = el('span', 'run' + (run.bold ? ' run--bold' : '') + (run.underline ? ' run--underline' : ''));
  if (run.width === 1 && run.height === 1) {
    span.textContent = run.text;
    return span;
  }
  // Taller text is a bigger font; a width that differs from the height stretches it sideways.
  // The box keeps the paper's columns: the run takes its characters times its width.
  span.classList.add('run--sized');
  span.style.width = (Array.from(run.text).length * run.width) + 'ch';
  span.style.height = (1.5 * run.height) + 'em';
  const inner = el('span', 'run__text', run.text);
  inner.style.fontSize = run.height + 'em';
  if (run.width !== run.height) inner.style.transform = 'scaleX(' + run.width / run.height + ')';
  span.append(inner);
  return span;
}

function receiptNode(receipt, paper) {
  const node = el('section', 'receipt receipt--' + paper);
  node.setAttribute('aria-label', paper + ' mm receipt');
  for (const line of receipt.lines) {
    const lineNode = el('div', 'line line--' + line.align);
    const tallest = Math.max(1, ...line.runs.map((run) => run.height));
    lineNode.style.minHeight = (1.5 * tallest) + 'em';
    for (const run of line.runs) lineNode.append(runNode(run));
    node.append(lineNode);
  }
  node.append(el('div', receipt.cut ? 'cut' : 'torn'));
  return node;
}

function jobNode(job) {
  const node = el('article', 'job');
  const at = new Date(job.receivedAt).toLocaleTimeString();
  node.append(el('p', 'job__meta', '#' + job.id + ' at ' + at + ', ' + job.bytes + ' bytes, ' + job.paper + ' mm'));
  if (job.drawerKicks > 0) node.append(el('p', 'job__note', 'Cash drawer opened'));
  if (job.unknown.length > 0) node.append(el('p', 'job__meta', 'Not drawn: ' + job.unknown.join(', ')));
  if (job.receipts.length === 0) node.append(el('p', 'job__meta', 'Nothing printed'));
  for (const receipt of job.receipts) node.append(receiptNode(receipt, job.paper));
  return node;
}

async function refresh() {
  const jobs = await (await fetch('/jobs.json')).json();
  list.replaceChildren(...jobs.map(jobNode));
  if (jobs.length === 0) list.append(el('p', 'empty', 'No tickets yet. Print a test page from the console.'));
  status.textContent = jobs.length === 0 ? status.textContent : jobs.length + ' ticket(s), newest first';
}

document.getElementById('clear').addEventListener('click', async () => {
  await fetch('/clear', { method: 'POST' });
});
new EventSource('/events').onmessage = () => { void refresh(); };
void refresh();
`;
