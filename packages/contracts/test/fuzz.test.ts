import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ROUTES, type RouteDefinition } from '../src/routes.js';
import { HOSTILE_VALUES, mutationsOf, sampleOf, UNKNOWN_ID } from '../src/testing/fuzz.js';

describe('contract fuzzing helpers (QA audit, category A)', () => {
  it('makes a sample that parses for most request schemas of the registry', () => {
    const routes: readonly RouteDefinition[] = ROUTES;
    const schemas = routes.flatMap((route) =>
      [route.request?.body, route.request?.query].filter((schema) => schema !== undefined),
    );
    const parsing = schemas.filter((schema) => schema.safeParse(sampleOf(schema)).success);
    // The rest have patterns or rules across fields; the fuzz tests give them samples by hand.
    expect(parsing.length / schemas.length).toBeGreaterThan(0.85);
  });

  it('fills ids from the hints and respects bounds', () => {
    const schema = z.strictObject({
      itemId: z.uuid(),
      other: z.uuid(),
      quantity: z.int().min(1).max(99),
      note: z.string().min(3).max(5),
      kind: z.enum(['A', 'B']),
      optional: z.string().optional(),
    });
    const sample = sampleOf(schema, {
      valueFor: (path) => (path.at(-1) === 'itemId' ? 'f'.repeat(8) : undefined),
    }) as Record<string, unknown>;
    expect(sample.itemId).toBe('ffffffff');
    expect(sample.other).toBe(UNKNOWN_ID);
    expect(sample.quantity).toBe(1);
    expect(String(sample.note).length).toBeLessThanOrEqual(5);
    expect(sample.kind).toBe('A');
  });

  it('varies every field, nested ones included, with every hostile value', () => {
    const sample = { lines: [{ quantity: 1 }], note: 'x' };
    const labels = mutationsOf(sample).map((mutation) => mutation.label);
    for (const [label] of HOSTILE_VALUES) {
      expect(labels).toContain(`lines.0.quantity = ${label}`);
      expect(labels).toContain(`note = ${label}`);
    }
    expect(labels).toContain('note missing');
    expect(labels).toContain('lines x 10,000');
    expect(labels).toContain('lines.0 + unknown field');
    expect(labels).toContain('(body) + unknown field');
  });

  it('never changes the sample it varies', () => {
    const sample = { lines: [{ quantity: 1 }] };
    mutationsOf(sample);
    expect(sample).toEqual({ lines: [{ quantity: 1 }] });
  });
});

describe('[NFR-L03] dates the database can store (QA-004)', () => {
  it('refuses year 0, which PostgreSQL has not, and accepts real dates', async () => {
    const { IsoDate } = await import('../src/common.js');
    expect(IsoDate.safeParse('0000-01-01').success).toBe(false);
    expect(IsoDate.safeParse('2026-03-31').success).toBe(true);
    expect(IsoDate.safeParse('2028-02-29').success).toBe(true);
    expect(IsoDate.safeParse('2026-02-30').success).toBe(false);
  });
});
