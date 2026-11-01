import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const SERVER_DIST = join(here, '..', '..', 'server', 'dist');
export const CONSOLE_DIST = join(here, '..', 'dist');
/** The waiter app built for phones' browsers (P9-28), served at /phone/. */
export const PHONE_DIST = join(here, '..', '..', 'waiter-app', 'dist');
