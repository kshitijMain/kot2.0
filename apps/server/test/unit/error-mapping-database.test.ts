import { describe, expect, it } from 'vitest';
import { mapError } from '../../src/errors/error-mapping.js';

/** A database error as Prisma 7 raises it through the PostgreSQL adapter (seen in the audit). */
function prismaError(code: string, originalCode?: string): Error {
  const error = new Error(`\nInvalid \`prisma.role.create()\` invocation in /srv/app.ts:12`);
  Object.assign(error, {
    name: 'PrismaClientKnownRequestError',
    code,
    meta:
      originalCode === undefined
        ? {}
        : { driverAdapterError: { cause: { originalCode, kind: 'postgres' } } },
  });
  return error;
}

describe('[SEC-004] [NFR-A03] database errors reach people as plain answers (QA-021)', () => {
  it.each([
    ['a clash on a unique key', prismaError('P2002', '23505'), 409, 'CONFLICT', true],
    ['a deadlock', prismaError('P2010', '40P01'), 503, 'TRY_AGAIN', true],
    ['a serialization failure', prismaError('P2034'), 503, 'TRY_AGAIN', true],
    ['a record gone meanwhile', prismaError('P2025'), 404, 'NOT_FOUND', false],
    ['text the database cannot store', prismaError('P2010', '22021'), 400, 'INVALID_TEXT', false],
    ['a number out of range', prismaError('P2020'), 422, 'VALUE_OUT_OF_RANGE', false],
    [
      'a number out of range (raw)',
      prismaError('P2010', '22003'),
      422,
      'VALUE_OUT_OF_RANGE',
      false,
    ],
    ['a date out of range', prismaError('P2010', '22008'), 422, 'VALUE_OUT_OF_RANGE', false],
    ['the database not reachable', prismaError('P1001'), 503, 'DATABASE_UNAVAILABLE', true],
    ['the database pool timing out', prismaError('P2024'), 503, 'DATABASE_UNAVAILABLE', true],
    [
      'the database shutting down',
      prismaError('P2010', '57P01'),
      503,
      'DATABASE_UNAVAILABLE',
      true,
    ],
  ] as const)('maps %s', (_, error, status, code, unexpected) => {
    const mapped = mapError(error, 'corr-1');
    expect(mapped.status).toBe(status);
    expect(mapped.body.code).toBe(code);
    expect(mapped.unexpected).toBe(unexpected);
    // Nothing of the query, the file or the library reaches the person.
    expect(mapped.body.message).not.toMatch(/prisma|invocation|\/srv|P20|23505/i);
    expect(mapped.body.correlationId).toBe('corr-1');
  });

  it('still answers anything else as an internal error', () => {
    expect(mapError(prismaError('P2010', '22012')).status).toBe(500);
  });
});
