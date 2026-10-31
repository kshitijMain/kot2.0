// Adds a restaurant to a self-hosted relay and issues its local server's credential (P9-01,
// ADR-0024), as the Control Plane does (VCP-002) until it provisions self-hosted relays itself.
//
//   RELAY_PROVISION_DB_URL=postgresql://relay_control_plane:...@127.0.0.1/rp_relay \
//     node scripts/provision-restaurant.mjs --name "Mannat" [--label "Counter PC"]
//
// The credential is printed once and never stored here: the relay keeps only its SHA-256. Pipe
// it into the restaurant PC's `pnpm --filter @rp/server relay:credential`, then forget it.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    label: { type: 'string', default: 'Restaurant PC' },
    'tenant-id': { type: 'string' },
  },
});
const url = process.env.RELAY_PROVISION_DB_URL;
if (url === undefined || url === '' || values.name === undefined || values.name.trim() === '') {
  process.stderr.write(
    'Usage: RELAY_PROVISION_DB_URL=... node scripts/provision-restaurant.mjs --name "Mannat"\n',
  );
  process.exit(1);
}

const tenantId = values['tenant-id'] ?? randomUUID();
const credential = randomBytes(32).toString('base64url');
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('BEGIN');
  // The Control Plane's login may take the provisioner's role and nothing else (RELAY-E3).
  await client.query('SET LOCAL ROLE relay_provisioner');
  await client.query('SELECT relay.provision_tenant($1, $2)', [tenantId, values.name.trim()]);
  await client.query('SELECT relay.add_credential($1, $2, $3)', [
    tenantId,
    createHash('sha256').update(credential, 'utf8').digest(),
    values.label,
  ]);
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

process.stdout.write(
  [
    `Restaurant: ${values.name.trim()}`,
    `Relay id:   ${tenantId}`,
    '',
    'Credential for its PC (shown once; the relay keeps only a hash):',
    credential,
    '',
  ].join('\n'),
);
