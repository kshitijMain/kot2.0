import { config } from 'zod';

/**
 * Zod compiles faster parsers with `new Function` unless told not to. The phone page's CSP allows
 * no eval and its Trusted Types refuse it (SEC-017), so Zod would only probe, fail and report a
 * violation on every load (P9-28, as the console does). index.ts imports this first, before any
 * schema is built.
 */
config({ jitless: true });
