// Applies the relay's migrations to a self-hosted PostgreSQL (P9-01, ADR-0024), the way
// `supabase db push` does on Supabase: each file once, in name order, each in its own
// transaction, recorded in `public.relay_host_migrations`.
//
//   sudo -u postgres env RELAY_ADMIN_DB_URL='postgresql:///rp_relay?host=/var/run/postgresql' \
//     node scripts/migrate.mjs
//
// As on Supabase, migrations run as the database's superuser: they create the relay's
// cluster-wide roles and grant them. The relay host itself never holds this login: it serves
// requests as relay_edge and runs its jobs as relay_janitor.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env.RELAY_ADMIN_DB_URL;
if (url === undefined || url === '') {
  process.stderr.write('Set RELAY_ADMIN_DB_URL to a superuser connection to the relay database.\n');
  process.exit(1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const files = readdirSync(dir)
  .filter((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file))
  .sort();

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS public.relay_host_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await client.query('SELECT name FROM public.relay_host_migrations');
  const applied = new Set(rows.map((row) => row.name));
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    process.stdout.write(`Applying ${file}\n`);
    await client.query('BEGIN');
    try {
      await client.query(readFileSync(join(dir, file), 'utf8'));
      await client.query('INSERT INTO public.relay_host_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
    count += 1;
  }
  process.stdout.write(
    count === 0 ? 'Nothing to apply; the relay is up to date.\n' : `Applied ${count}.\n`,
  );
} finally {
  await client.end();
}
