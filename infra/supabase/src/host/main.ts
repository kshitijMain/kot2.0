// The self-hosted QR relay's entry (P9-01, ADR-0024): `node relay-host.mjs`, settings from the
// environment. Bundled into one file by scripts/bundle-functions.mjs, so a server needs only Node.
import { hostConfigFrom } from './config.js';
import { startHost } from './host.js';

const log = (message: string) => {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
};

const host = await startHost(hostConfigFrom(), log);

let stopping = false;
const stop = (signal: string) => {
  if (stopping) return;
  stopping = true;
  log(`${signal}: stopping`);
  host.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.on('SIGTERM', () => {
  stop('SIGTERM');
});
process.on('SIGINT', () => {
  stop('SIGINT');
});
