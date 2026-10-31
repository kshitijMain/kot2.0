// The QR pilot's set-up (P9-06): `pnpm --filter @rp/server pilot:mannat [-- --upi-id name@bank]
// [--site https://menu.example.in] [--tents tents.pdf]`, after `build`. Reads DATABASE_URL and
// RP_DATA_DIR (for the secrets the server checks PINs with); refuses a database that already holds
// a restaurant. Prints each table's QR address and, with --tents, writes the A5 tents to print.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { UpiId } from '@rp/contracts/relay';
import { CredentialHasher } from '../auth/credential-hasher.js';
import { FileSecretStore } from '../auth/secret-store.js';
import { tableTentsPdf } from '../floor/table-tents.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { MANNAT_PINS, MANNAT_PROFILE, seedMannat } from './pilot-seed.js';
import { UTC_SESSION } from './utc-session.js';

const { values } = parseArgs({
  options: {
    'upi-id': { type: 'string' },
    site: { type: 'string', default: process.env.RP_QR_SITE_URL },
    tents: { type: 'string' },
  },
});
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  process.stderr.write('Set DATABASE_URL to the restaurant database.\n');
  process.exit(1);
}
const upiId = values['upi-id'];
if (upiId !== undefined && !UpiId.safeParse(upiId).success) {
  process.stderr.write(`"${upiId}" is not a UPI ID (name@bank).\n`);
  process.exit(1);
}
const site = values.site?.replace(/\/+$/, '');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl, options: UTC_SESSION }),
});
try {
  const hasher = new CredentialHasher(
    new FileSecretStore(join(process.env.RP_DATA_DIR ?? './.data', 'secrets')),
  );
  const summary = await seedMannat(prisma, {
    hashPin: (pin) => hasher.hash(pin),
    ...(upiId !== undefined && { upiId }),
  });
  const lines = [
    `Mannat is set up (restaurant ${summary.restaurantId}).`,
    '',
    'Staff and their first PINs (change them in Manage → Staff before service):',
    ...Object.entries(MANNAT_PINS).map(([name, pin]) => `  ${name.padEnd(18)} ${pin}`),
    '',
    'Tables and their QR codes:',
    ...summary.tables.map(
      (table) =>
        `  Table ${table.label.padEnd(3)} ${site === undefined ? table.code : `${site}/t/${table.code}`}`,
    ),
  ];
  if (upiId === undefined) {
    lines.push('', 'No UPI ID given: set the business UPI ID in Manage → Settings → Payments.');
  }
  if (values.tents !== undefined) {
    if (site === undefined) throw new Error('--tents needs --site (or RP_QR_SITE_URL)');
    const { pdf } = await tableTentsPdf(
      summary.tables.map((table) => ({ label: table.label, url: `${site}/t/${table.code}` })),
      {
        restaurantName: MANNAT_PROFILE.displayName,
        accentColor: MANNAT_PROFILE.accentColor ?? null,
      },
      'A5',
      { generatedAt: new Date().toISOString() },
    );
    await writeFile(values.tents, pdf);
    lines.push('', `Table tents (A5, ${String(summary.tables.length)} pages): ${values.tents}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
} finally {
  await prisma.$disconnect();
}
