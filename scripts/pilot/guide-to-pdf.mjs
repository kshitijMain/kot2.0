#!/usr/bin/env node
// Turns docs/guides/run-and-test-pilot.md into the PDF beside it (A4), with the browser Playwright
// already installed for the repository's tests. Refuses a command line over 80 characters, and
// anything wider than the page, so nothing can be cut off.
//
//   node scripts/pilot/guide-to-pdf.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = join(ROOT, 'docs/guides/run-and-test-pilot.md');
const TARGET = SOURCE.replace(/\.md$/, '.pdf');
const MAX_COMMAND_WIDTH = 80;

const { chromium } = createRequire(join(ROOT, 'apps/qr-menu/package.json'))('@playwright/test');

const escapeHtml = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());

const isTable = (line) => line.trim().startsWith('|');
const isList = (line) => /^(\s*)(-|\d+\.) /.test(line);

function list(lines) {
  const ordered = /^\s*\d+\. /.test(lines[0]);
  const items = [];
  for (const line of lines) {
    const match = /^(-|\d+\.) (.*)$/.exec(line);
    const current = items.at(-1);
    if (match !== null) items.push({ text: match[2], nested: [] });
    else if (/^\s+(-|\d+\.) /.test(line)) current.nested.push(line.trim());
    else if (current.nested.length > 0) current.nested.push(`  ${line.trim()}`);
    else current.text += ` ${line.trim()}`;
  }
  const tag = ordered ? 'ol' : 'ul';
  const html = items.map(
    (item) => `<li>${inline(item.text)}${item.nested.length > 0 ? list(item.nested) : ''}</li>`,
  );
  return `<${tag}>${html.join('')}</${tag}>`;
}

function toHtml(markdown) {
  const lines = markdown.split('\n');
  const output = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith('```')) {
      const code = [];
      for (index += 1; !lines[index].startsWith('```'); index += 1) code.push(lines[index]);
      index += 1;
      for (const command of code) {
        if (command.length > MAX_COMMAND_WIDTH)
          throw new Error(`Too long for the page: ${command}`);
      }
      output.push(`<pre>${escapeHtml(code.join('\n'))}</pre>`);
    } else if (isTable(line)) {
      const rows = [];
      while (index < lines.length && isTable(lines[index])) rows.push(cells(lines[index++]));
      const [head, , ...body] = rows;
      output.push(
        `<table class="cols-${String(head.length)}"><thead><tr>${head
          .map((cell) => `<th>${inline(cell)}</th>`)
          .join('')}</tr></thead><tbody>${body
          .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
    } else if (/^#{1,4} /.test(line)) {
      const level = /^#+/.exec(line)[0].length;
      output.push(`<h${String(level)}>${inline(line.slice(level + 1))}</h${String(level)}>`);
      index += 1;
    } else if (/^!\[/.test(line)) {
      const [, alt, file] = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(line);
      const svg = readFileSync(join(dirname(SOURCE), file), 'utf8');
      output.push(`<figure aria-label="${escapeHtml(alt)}">${svg}</figure>`);
      index += 1;
    } else if (isList(line)) {
      const block = [];
      while (index < lines.length && lines[index].trim() !== '') {
        if (!isList(lines[index]) && !/^\s+/.test(lines[index])) break;
        block.push(lines[index++]);
      }
      output.push(list(block));
    } else if (line.trim() === '') {
      index += 1;
    } else {
      const block = [];
      while (
        index < lines.length &&
        lines[index].trim() !== '' &&
        !isTable(lines[index]) &&
        !isList(lines[index]) &&
        !lines[index].startsWith('```') &&
        !lines[index].startsWith('#')
      ) {
        block.push(lines[index++]);
      }
      const text = block.join(' ');
      const window = text.startsWith('**Window:') ? ' class="window"' : '';
      output.push(`<p${window}>${inline(text)}</p>`);
    }
  }
  return output.join('\n');
}

const STYLE = `
  body { font: 10.5pt/1.45 "Liberation Sans", Arial, "DejaVu Sans", sans-serif; color: #1b1b1b; }
  h1 { font-size: 22pt; margin: 0 0 8pt; }
  h2 { font-size: 16pt; margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5pt solid #33691e; }
  h3 { font-size: 13pt; margin: 14pt 0 4pt; }
  h4 { font-size: 11pt; margin: 12pt 0 3pt; }
  h1, h2, h3, h4, .window { break-after: avoid; }
  p { margin: 4pt 0 6pt; }
  ul, ol { margin: 3pt 0 7pt; padding-left: 16pt; }
  li { margin: 2pt 0; break-inside: avoid; }
  a { color: #0b57d0; text-decoration: none; }
  code { font: 9pt "DejaVu Sans Mono", "Liberation Mono", monospace; background: #f0f0f0;
    padding: 0 2pt; overflow-wrap: anywhere; }
  pre { font: 9pt/1.4 "DejaVu Sans Mono", "Liberation Mono", monospace; background: #1f2933;
    color: #fff; padding: 6pt 8pt; margin: 3pt 0 6pt; border-radius: 3pt; white-space: pre;
    break-inside: avoid; break-after: avoid; }
  .window { margin: 8pt 0 2pt; color: #33691e; }
  figure { margin: 6pt 0 10pt; } figure svg { width: 100%; height: auto; }
  table { width: 100%; border-collapse: collapse; margin: 6pt 0 10pt; font-size: 9pt; line-height: 1.3; }
  th { background: #e8eee1; text-align: left; }
  th, td { border: 0.5pt solid #9aa58c; padding: 3pt 4pt; vertical-align: top; overflow-wrap: break-word; }
  td code { overflow-wrap: normal; }
  tr { break-inside: avoid; } thead { display: table-header-group; }
  table.cols-5 { font-size: 8pt; } table.cols-5 code { font-size: 7.5pt; }
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Running and testing the Parosaa pilot</title><style>${STYLE}</style></head>
<body>${toHtml(readFileSync(SOURCE, 'utf8'))}</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(html);
  await page.emulateMedia({ media: 'print' });
  // The page's text width on A4 with these margins: 210 mm less 2 x 15 mm, at 96 pixels per inch.
  await page.setViewportSize({ width: Math.floor((180 / 25.4) * 96), height: 1000 });
  const overflowing = await page.evaluate(() => {
    const limit = document.body.getBoundingClientRect().right + 0.5;
    return [...document.querySelectorAll('pre, table, figure, p, li, td')]
      .filter((element) => {
        const wide = element.scrollWidth > element.clientWidth + 1 && element.tagName === 'PRE';
        return wide || element.getBoundingClientRect().right > limit;
      })
      .map((element) => element.textContent.slice(0, 80));
  });
  if (overflowing.length > 0) {
    throw new Error(`Wider than the page:\n${overflowing.join('\n')}`);
  }
  await page.pdf({
    path: TARGET,
    format: 'A4',
    printBackground: true,
    margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="font-size:8pt;width:100%;text-align:center;color:#666"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  });
} finally {
  await browser.close();
}
process.stdout.write(`Written: ${TARGET}\n`);
