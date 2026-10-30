import { fitsPlan, PLAN_COLUMNS, PLAN_ROWS, TABLE_SHAPES, TABLE_SIZE } from '@rp/domain';
import { z } from 'zod';
import { Id, IsoDate, TableState, Timestamp } from './common.js';

/**
 * The floor (P1-02a, TBL-001, TBL-002, ONB-004 step 5): sections contain tables, and waiters are
 * assigned to sections or single tables for the business day.
 */

const Reason = z.string().trim().min(3).max(200);

// ---------------------------------------------------------------- sections and tables

export const SectionRequest = z.strictObject({
  name: z.string().trim().min(1).max(40),
  /** Position among the sections, lowest first. */
  displayOrder: z.int().min(0).max(999),
});
export type SectionRequest = z.infer<typeof SectionRequest>;

export const SectionParams = z.strictObject({ sectionId: Id });
export type SectionParams = z.infer<typeof SectionParams>;

export const TableRequest = z.strictObject({
  /** Number or name shown to staff and on tickets, e.g. "12" or "Terrace 3". */
  label: z.string().trim().min(1).max(20),
  /** Seats (covers) the table is laid for. */
  capacity: z.int().min(1).max(50),
  sectionId: Id,
  displayOrder: z.int().min(0).max(9_999),
});
export type TableRequest = z.infer<typeof TableRequest>;

export const TableParams = z.strictObject({ tableId: Id });
export type TableParams = z.infer<typeof TableParams>;

/** Where a table sits on its section's floor plan, in grid cells (ONB-004 step 5, S). */
export const TableLayout = z
  .strictObject({
    x: z
      .int()
      .min(0)
      .max(PLAN_COLUMNS - TABLE_SIZE.min),
    y: z
      .int()
      .min(0)
      .max(PLAN_ROWS - TABLE_SIZE.min),
    w: z.int().min(TABLE_SIZE.min).max(TABLE_SIZE.max),
    h: z.int().min(TABLE_SIZE.min).max(TABLE_SIZE.max),
    shape: z.enum(TABLE_SHAPES),
  })
  .refine(fitsPlan, { message: 'The table must fit on the plan' });
export type TableLayout = z.infer<typeof TableLayout>;

export const TableView = z.object({
  id: Id,
  label: z.string(),
  capacity: z.int().positive(),
  sectionId: Id,
  state: TableState,
  displayOrder: z.int().nonnegative(),
  /** Active table tablets bound to the table (TBL-001, AUTH-009). */
  tabletDeviceIds: z.array(Id),
  /** Its place on the section's floor plan; null until someone places it. */
  layout: TableLayout.nullable().default(null),
  archivedAt: Timestamp.nullable(),
  updatedAt: Timestamp,
});
export type TableView = z.infer<typeof TableView>;

export const SectionView = z.object({
  id: Id,
  name: z.string(),
  displayOrder: z.int().nonnegative(),
  archivedAt: Timestamp.nullable(),
  /** Its tables in display order, archived ones included. */
  tables: z.array(TableView),
  updatedAt: Timestamp,
});
export type SectionView = z.infer<typeof SectionView>;

/** The whole floor in display order, archived sections and tables included (clients filter). */
export const FloorResponse = z.object({ sections: z.array(SectionView) });
export type FloorResponse = z.infer<typeof FloorResponse>;

/**
 * The floor plan as dragged (ONB-004 step 5, S): the tables whose place changed, each with its
 * new place or null to take it off the plan. Tables of one section may not overlap.
 */
export const FloorLayoutRequest = z.strictObject({
  tables: z
    .array(z.strictObject({ tableId: Id, layout: TableLayout.nullable() }))
    .min(1)
    .max(500),
});
export type FloorLayoutRequest = z.infer<typeof FloorLayoutRequest>;

/** Archived sections and tables are hidden, never deleted (BRD §9.4). */
export const FloorArchiveRequest = z.strictObject({ reason: Reason });
export type FloorArchiveRequest = z.infer<typeof FloorArchiveRequest>;

// ---------------------------------------------------------------- tables a waiter sent KOTs to

/**
 * The tables the signed-in person sent a KOT to on the business day (ADR-0023): the waiter app's
 * "Tables I sent KOTs to today" filter. There are no waiter assignments: any waiter serves any table.
 */
export const MyKotTablesResponse = z.object({
  businessDate: IsoDate,
  tableIds: z.array(Id),
});
export type MyKotTablesResponse = z.infer<typeof MyKotTablesResponse>;
