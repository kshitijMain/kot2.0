// Reads the ESC/POS bytes a thermal printer receives and turns them into receipts: lines of
// styled text (alignment, bold, double width and height), split at each paper cut. Development
// tooling only (the virtual printer); never shipped to restaurants. It understands what
// apps/server/src/printing/escpos.ts sends, and steps over other common commands.

const ESC = 0x1b;
const GS = 0x1d;
const DLE = 0x10;
const LF = 0x0a;
const CR = 0x0d;

const ALIGNMENTS = ['left', 'centre', 'right'];

/** Characters per line in font A: 32 on 58 mm paper, 48 on 80 mm. */
export const COLUMNS = { 58: 32, 80: 48 };

/** UTF-8 when the bytes are valid UTF-8 (so a ₹ sent as UTF-8 shows as ₹), else Latin-1. */
function decode(bytes) {
  const buffer = Uint8Array.from(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('latin1').decode(buffer);
  }
}

/**
 * Parses one print job. Returns its receipts (a new one starts after each cut), each a list of
 * lines `{ align, runs: [{ text, bold, underline, width, height }] }`, whether it was cut, the
 * cash drawer pulses, and the commands it did not understand (as hex, for the page to show).
 */
export function parseEscPos(input) {
  const bytes = input instanceof Uint8Array ? input : Uint8Array.from(input);
  const receipts = [];
  const unknown = [];
  let drawerKicks = 0;
  let style;
  let lines;
  let runs;
  let pending;
  let align;

  const reset = () => {
    style = { bold: false, underline: false, width: 1, height: 1 };
    align = 'left';
  };
  const flushRun = () => {
    if (pending.length === 0) return;
    runs.push({ text: decode(pending), ...style });
    pending = [];
  };
  const newReceipt = () => {
    lines = [];
    runs = [];
    pending = [];
  };
  const endLine = () => {
    flushRun();
    lines.push({ align, runs });
    runs = [];
  };
  const setStyle = (change) => {
    flushRun();
    style = { ...style, ...change };
  };
  const cut = () => {
    if (pending.length > 0 || runs.length > 0) endLine();
    receipts.push({ lines, cut: true });
    newReceipt();
  };
  const feed = (count) => {
    if (pending.length > 0 || runs.length > 0) endLine();
    for (let index = 0; index < count; index += 1) lines.push({ align, runs: [] });
  };

  reset();
  newReceipt();
  let at = 0;
  const next = () => (at < bytes.length ? bytes[at++] : undefined);
  while (at < bytes.length) {
    const byte = next();
    if (byte === ESC) {
      const command = next();
      switch (command) {
        case 0x40: // ESC @ initialise
          flushRun();
          reset();
          break;
        case 0x61: {
          // ESC a n alignment (0/48 left, 1/49 centre, 2/50 right)
          const n = next() ?? 0;
          flushRun();
          align = ALIGNMENTS[n % 48] ?? 'left';
          break;
        }
        case 0x45: // ESC E n bold
          setStyle({ bold: ((next() ?? 0) & 1) === 1 });
          break;
        case 0x2d: // ESC - n underline
          setStyle({ underline: ((next() ?? 0) & 3) !== 0 });
          break;
        case 0x21: {
          // ESC ! n print mode: bold, double height, double width
          const n = next() ?? 0;
          setStyle({
            bold: (n & 0x08) !== 0,
            height: (n & 0x10) !== 0 ? 2 : 1,
            width: (n & 0x20) !== 0 ? 2 : 1,
            underline: (n & 0x80) !== 0,
          });
          break;
        }
        case 0x64: // ESC d n feed n lines
          feed(next() ?? 0);
          break;
        case 0x4a: // ESC J n feed dots
          next();
          break;
        case 0x70: // ESC p m t1 t2 cash drawer pulse
          next();
          next();
          next();
          drawerKicks += 1;
          break;
        case 0x69: // ESC i, ESC m: old cut commands
        case 0x6d:
          cut();
          break;
        case 0x4d: // ESC M n font
        case 0x74: // ESC t n code page
        case 0x52: // ESC R n character set
        case 0x47: // ESC G n double strike
        case 0x7b: // ESC { n upside down
          next();
          break;
        default:
          unknown.push(`1b ${hex(command)}`);
      }
    } else if (byte === GS) {
      const command = next();
      switch (command) {
        case 0x21: {
          // GS ! n character size: width (high nibble) and height (low nibble), 1 to 8 times
          const n = next() ?? 0;
          setStyle({ width: ((n >> 4) & 7) + 1, height: (n & 7) + 1 });
          break;
        }
        case 0x56: {
          // GS V m [n] cut; m 65/66 feed n lines first
          const m = next() ?? 0;
          if (m === 65 || m === 66) feed(next() ?? 0);
          cut();
          break;
        }
        case 0x42: // GS B n reverse
        case 0x66: // GS f n barcode font
        case 0x68: // GS h n barcode height
        case 0x77: // GS w n barcode width
        case 0x48: // GS H n barcode text position
          next();
          break;
        default:
          unknown.push(`1d ${hex(command)}`);
      }
    } else if (byte === DLE) {
      // DLE EOT n, DLE ENQ n: status requests, which print nothing
      next();
      next();
    } else if (byte === LF) {
      endLine();
    } else if (byte === CR || (byte !== undefined && byte < 0x20)) {
      // Carriage returns and other control characters print nothing.
    } else if (byte !== undefined) {
      pending.push(byte);
    }
  }
  if (pending.length > 0 || runs.length > 0) endLine();
  if (lines.length > 0) receipts.push({ lines, cut: false });
  return { receipts, drawerKicks, unknown };
}

function hex(byte) {
  return byte === undefined ? '??' : byte.toString(16).padStart(2, '0');
}

/** How many characters a line takes across the paper (double-width text takes two each). */
export function lineCells(line) {
  return line.runs.reduce((cells, run) => cells + [...run.text].length * run.width, 0);
}

/**
 * The paper the job was meant for: what the server's printer setting says is not in the bytes,
 * so it is told by the widest line (more than 32 characters is 80 mm), or by `forced`.
 */
export function paperWidthOf(job, forced) {
  if (forced === 58 || forced === 80) return forced;
  const widest = Math.max(
    0,
    ...job.receipts.flatMap((receipt) => receipt.lines.map((line) => lineCells(line))),
  );
  return widest > COLUMNS[58] ? 80 : 58;
}
