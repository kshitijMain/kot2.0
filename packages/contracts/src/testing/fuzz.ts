import { z } from 'zod';

/**
 * Contract-driven input fuzzing for tests (QA audit, category A): a plausible value for any
 * request schema, and hostile variations of it, field by field. The server and Control Plane
 * fuzz tests walk their route registries with these, so a new endpoint is fuzzed as soon as it is
 * registered. Test tooling only; no app imports it.
 */

/** A JSON Schema node, as `z.toJSONSchema` writes it (only what the generator reads). */
interface JsonSchema {
  readonly $ref?: string;
  readonly $defs?: Readonly<Record<string, JsonSchema>>;
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly default?: unknown;
  readonly anyOf?: readonly JsonSchema[];
  readonly oneOf?: readonly JsonSchema[];
  readonly allOf?: readonly JsonSchema[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly prefixItems?: readonly JsonSchema[];
  readonly minItems?: number;
  readonly format?: string;
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly exclusiveMaximum?: number;
}

/** Where a value sits in a request: `['lines', '0', 'itemId']`. */
export type FuzzPath = readonly string[];

export interface SampleHints {
  /** A real value for a field (an existing record's id, a known key), or undefined for any. */
  readonly valueFor?: (path: FuzzPath, schema: { format?: string }) => unknown;
}

/** A fixed, valid UUIDv4 for ids that point at nothing. */
export const UNKNOWN_ID = '6f1c1c3e-8a7b-4c2d-9e0f-123456789abc';

/** Strings tried, in order, for a pattern the generator does not otherwise know. */
const PATTERN_CANDIDATES = [
  '1234',
  '123456',
  '12:30',
  '12:30:00',
  '9876543210',
  '+91 98765 43210',
  '27AAPFU0939F1ZV',
  '996331',
  'GST',
  'abc',
  'A1',
  'a',
  'qa@example.com',
  'https://example.com',
  '2026-10-27',
  '2026-10',
  'RP-PAGER:ABC123',
  '1.0.0',
];

const todayIso = () => new Date().toISOString().slice(0, 10);

function resolve(root: JsonSchema, node: JsonSchema): JsonSchema {
  if (node.$ref === undefined) return node;
  const name = node.$ref.replace(/^#\/\$defs\//, '');
  const target = root.$defs?.[name];
  return target === undefined ? {} : resolve(root, target);
}

function stringSample(node: JsonSchema): string {
  switch (node.format) {
    case 'uuid':
      return UNKNOWN_ID;
    case 'date':
      return todayIso();
    case 'date-time':
      return new Date().toISOString();
    case 'time':
      return '12:00:00';
    case 'email':
      return 'qa@example.com';
    case 'uri':
    case 'url':
      return 'https://example.com';
    default:
      break;
  }
  const min = node.minLength ?? 0;
  const max = node.maxLength ?? Number.POSITIVE_INFINITY;
  if (node.pattern !== undefined) {
    const pattern = new RegExp(node.pattern, 'u');
    const found = PATTERN_CANDIDATES.find(
      (candidate) => pattern.test(candidate) && candidate.length >= min && candidate.length <= max,
    );
    if (found !== undefined) return found;
  }
  const base = 'QA sample';
  if (base.length > max) return 'a'.repeat(Math.max(min, Math.min(max, 1)));
  return base.length >= min ? base : base.padEnd(min, 'x');
}

function numberSample(node: JsonSchema, integer: boolean): number {
  const lower =
    node.minimum ?? (node.exclusiveMinimum !== undefined ? node.exclusiveMinimum + 1 : undefined);
  const upper =
    node.maximum ?? (node.exclusiveMaximum !== undefined ? node.exclusiveMaximum - 1 : undefined);
  let value = Math.max(lower ?? 1, 1);
  if (upper !== undefined && value > upper) value = upper;
  return integer ? Math.ceil(value) : value;
}

function sampleNode(
  root: JsonSchema,
  raw: JsonSchema,
  path: FuzzPath,
  hints: SampleHints,
  optional: boolean,
): unknown {
  const node = resolve(root, raw);
  const hinted = hints.valueFor?.(path, {
    ...(node.format !== undefined && { format: node.format }),
  });
  if (hinted !== undefined) return hinted;
  if (node.const !== undefined) return node.const;
  if (node.enum !== undefined && node.enum.length > 0) return node.enum[0];
  const options = node.anyOf ?? node.oneOf;
  if (options !== undefined) {
    const nonNull = options.filter((option) => resolve(root, option).type !== 'null');
    return sampleNode(root, nonNull[0] ?? options[0] ?? {}, path, hints, optional);
  }
  if (node.allOf !== undefined) {
    const parts = node.allOf.map((part) => sampleNode(root, part, path, hints, optional));
    return parts.every((part) => typeof part === 'object' && part !== null && !Array.isArray(part))
      ? Object.assign({}, ...parts)
      : parts[0];
  }
  const type = Array.isArray(node.type)
    ? (node.type as readonly string[]).find((kind) => kind !== 'null')
    : node.type;
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      const required = new Set(node.required ?? []);
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (!optional && !required.has(key)) continue;
        out[key] = sampleNode(root, child, [...path, key], hints, optional);
      }
      return out;
    }
    case 'array': {
      if (node.prefixItems !== undefined) {
        return node.prefixItems.map((item, index) =>
          sampleNode(root, item, [...path, String(index)], hints, optional),
        );
      }
      const count = Math.max(node.minItems ?? 1, 1);
      return Array.from({ length: count }, (_, index) =>
        sampleNode(root, node.items ?? {}, [...path, String(index)], hints, optional),
      );
    }
    case 'string':
      return stringSample(node);
    case 'integer':
      return numberSample(node, true);
    case 'number':
      return numberSample(node, false);
    case 'boolean':
      return true;
    case 'null':
      return null;
    default:
      return node.default ?? 'QA sample';
  }
}

/**
 * A plausible value for `schema`: every optional field filled in when that still parses,
 * otherwise only the required ones. It may still not parse (a refinement across fields); the
 * fuzz then works from what it has.
 */
export function sampleOf(schema: z.ZodType, hints: SampleHints = {}): unknown {
  const root = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
  const full = sampleNode(root, root, [], hints, true);
  if (schema.safeParse(full).success) return full;
  const lean = sampleNode(root, root, [], hints, false);
  return schema.safeParse(lean).success ? lean : full;
}

/** One hostile variation of a request. */
export interface Mutation {
  /** What was changed, e.g. `lines.0.quantity = 2147483648`. */
  readonly label: string;
  readonly value: unknown;
}

const LONG = 'x'.repeat(10_001);

/**
 * Values tried in place of every field: wrong types, empties, huge and negative numbers,
 * decimals, unsafe integers, odd dates, and text that must not break screens or printers
 * (scripts, control characters, right-to-left marks, emoji, Hindi).
 */
export const HOSTILE_VALUES: readonly (readonly [string, unknown])[] = [
  ['null', null],
  ['empty string', ''],
  ['blank string', '   '],
  ['10,001 characters', LONG],
  ['control characters', 'A\u0000B\u0007C\u001b@\u001bd\u0005\r\nD'],
  ['script tag', '<script>alert(1)</script><img src=x onerror=alert(1)>'],
  ['right-to-left override', 'שלום ‮txt.exe'],
  ['emoji', '🍛🔥'.repeat(150)],
  ['Hindi', 'पनीर बटर मसाला (आधा)'],
  ['formula', '=HYPERLINK("http://evil","x")'],
  ['-1', -1],
  ['0', 0],
  ['0.5', 0.5],
  ['-0.5', -0.5],
  ['2^31', 2_147_483_648],
  ['-2^31 - 1', -2_147_483_649],
  ['max safe integer', Number.MAX_SAFE_INTEGER],
  ['2^53 + 2', 9_007_199_254_740_994],
  ['1e308', 1e308],
  ['true', true],
  ['empty object', {}],
  ['empty array', []],
  ['not an id', 'not-an-id'],
  ['nil uuid', '00000000-0000-0000-0000-000000000000'],
  ['30 February', '2026-02-30'],
  ['month 13', '2026-13-01'],
  ['year 0', '0000-01-01'],
  ['year 9999', '9999-12-31T23:59:59Z'],
  ['epoch', '1970-01-01T00:00:00Z'],
];

function setAt(target: unknown, path: FuzzPath, value: unknown, remove: boolean): unknown {
  const copy = JSON.parse(JSON.stringify(target)) as Record<string, unknown> | unknown[];
  let node: Record<string, unknown> | unknown[] = copy;
  for (const step of path.slice(0, -1)) {
    node = (node as Record<string, unknown>)[step] as Record<string, unknown> | unknown[];
  }
  const last = path[path.length - 1] ?? '';
  if (remove) {
    if (Array.isArray(node)) node.splice(Number(last), 1);
    else Reflect.deleteProperty(node, last);
  } else (node as Record<string, unknown>)[last] = value;
  return copy;
}

function leafPaths(value: unknown, path: FuzzPath, out: FuzzPath[], objects: FuzzPath[]): void {
  if (Array.isArray(value)) {
    if (path.length > 0) out.push(path);
    if (value.length > 0) leafPaths(value[0], [...path, '0'], out, objects);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    objects.push(path);
    if (path.length > 0) out.push(path);
    for (const [key, child] of Object.entries(value))
      leafPaths(child, [...path, key], out, objects);
    return;
  }
  if (path.length > 0) out.push(path);
}

/**
 * Hostile variations of `sample`: the whole body replaced by wrong types; for every field, the
 * field missing and each of `HOSTILE_VALUES` in its place; for every array, ten thousand copies of
 * its first element; and an unknown extra field on every object.
 */
export function mutationsOf(sample: unknown): Mutation[] {
  const mutations: Mutation[] = [
    { label: '(body) null', value: null },
    { label: '(body) a string', value: 'QA' },
    { label: '(body) a number', value: 42 },
    { label: '(body) an array', value: [sample] },
    { label: '(body) empty object', value: {} },
  ];
  const paths: FuzzPath[] = [];
  const objects: FuzzPath[] = [];
  leafPaths(sample, [], paths, objects);
  for (const path of paths) {
    const name = path.join('.');
    mutations.push({ label: `${name} missing`, value: setAt(sample, path, undefined, true) });
    for (const [label, value] of HOSTILE_VALUES) {
      mutations.push({ label: `${name} = ${label}`, value: setAt(sample, path, value, false) });
    }
    const current = path.reduce<unknown>(
      (node, step) => (node as Record<string, unknown>)[step],
      sample,
    );
    if (Array.isArray(current) && current.length > 0) {
      mutations.push({
        label: `${name} x 10,000`,
        value: setAt(
          sample,
          path,
          Array.from({ length: 10_000 }, (): unknown => current[0]),
          false,
        ),
      });
    }
  }
  for (const path of objects) {
    const name = path.length === 0 ? '(body)' : path.join('.');
    mutations.push({
      label: `${name} + unknown field`,
      value: setAt(sample, [...path, 'qaUnknownField'], 'x', false),
    });
  }
  return mutations;
}
