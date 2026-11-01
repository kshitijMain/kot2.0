import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrintFailure, PrinterTransport, type PrintTarget } from './printer-transport.js';

/**
 * TEST ONLY (P9-25), for the pilot on a Mac with no printer: instead of printing, every job (KOT,
 * bill, reprint, test page) is saved in a folder as the printer's own bytes (`.bin`) and as the
 * text a person would read on the slip (`.txt`), so each print button can be checked. Turned on
 * only by `RP_PRINT_TO_FOLDER`; the Business Owner will replace it with a real printer, and this
 * file and that variable can then be deleted.
 */
export class FolderTransport extends PrinterTransport {
  private count = 0;

  constructor(
    private readonly folder: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
  }

  async send(target: PrintTarget, bytes: Uint8Array): Promise<void> {
    this.count += 1;
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const printer = target.host.replace(/[^A-Za-z0-9.-]+/g, '_');
    const name = `${stamp}-${String(this.count).padStart(4, '0')}-${printer}`;
    try {
      await mkdir(this.folder, { recursive: true });
      await writeFile(join(this.folder, `${name}.bin`), bytes);
      await writeFile(join(this.folder, `${name}.txt`), slipText(bytes));
    } catch (error) {
      throw new PrintFailure(`The test print folder ${this.folder} could not be written.`, {
        cause: error,
      });
    }
  }
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** How many bytes each ESC/POS command the renderer uses takes, its first two bytes included. */
function commandLength(bytes: Uint8Array, at: number): number {
  const lead = bytes[at];
  const code = bytes[at + 1];
  if (lead === ESC) return code === 0x40 ? 2 : 3; // ESC @ initialise; ESC a / E / d / ! n
  if (code === 0x56) return bytes[at + 2] === 0x41 || bytes[at + 2] === 0x42 ? 4 : 3; // GS V cut
  return 3; // GS ! size, GS B reverse
}

/** The words on the slip: ESC/POS commands dropped, a cut shown as a dashed line. */
export function slipText(bytes: Uint8Array): string {
  let text = '';
  let at = 0;
  while (at < bytes.length) {
    const byte = bytes[at] ?? 0;
    if (byte === ESC || byte === GS) {
      if (byte === GS && bytes[at + 1] === 0x56) text += '\n- - - - - - - - cut - - - - - - - -\n';
      at += commandLength(bytes, at);
      continue;
    }
    if (byte === LF) text += '\n';
    else if (byte >= 0x20 && byte < 0x7f) text += String.fromCharCode(byte);
    at += 1;
  }
  return text;
}
