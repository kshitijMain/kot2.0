// Types for escpos-parser.mjs (the virtual printer's ESC/POS reader), for the tests that check it
// against the server's own receipts.

export interface PrintedRun {
  readonly text: string;
  readonly bold: boolean;
  readonly underline: boolean;
  /** 1 for normal, 2 for double width, up to 8. */
  readonly width: number;
  readonly height: number;
}

export interface PrintedLine {
  readonly align: 'left' | 'centre' | 'right';
  readonly runs: readonly PrintedRun[];
}

export interface PrintedReceipt {
  readonly lines: readonly PrintedLine[];
  /** The paper was cut after it (the last receipt of a job may not be). */
  readonly cut: boolean;
}

export interface ParsedJob {
  readonly receipts: readonly PrintedReceipt[];
  /** Cash drawer pulses (ESC p). */
  readonly drawerKicks: number;
  /** Commands it does not know, as hex. */
  readonly unknown: readonly string[];
}

export declare const COLUMNS: { readonly 58: 32; readonly 80: 48 };

export declare function parseEscPos(bytes: Uint8Array | readonly number[]): ParsedJob;

export declare function lineCells(line: PrintedLine): number;

export declare function paperWidthOf(job: Pick<ParsedJob, 'receipts'>, forced?: number): 58 | 80;
