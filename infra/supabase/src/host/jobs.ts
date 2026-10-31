import pg from 'pg';

/**
 * The relay's two scheduled jobs, where there is no pg_cron (P9-01, ADR-0024): orders past their
 * pickup time marked EXPIRED every minute (an overdue order already reads EXPIRED at once, so
 * this only makes the stored status agree, QR-007), and retention every hour (`relay.purge`,
 * BRD §9.3). Both run with their owner's rights; the jobs log in as `relay_janitor`, which may
 * run these two and nothing else (migration 20261031100000).
 */
export interface Jobs {
  /** Runs both now (tests, and once at start-up). */
  runNow(): Promise<void>;
  stop(): Promise<void>;
}

export function startJobs(options: {
  readonly databaseUrl: string;
  readonly expireEveryMs?: number;
  readonly purgeEveryMs?: number;
  readonly log?: (message: string) => void;
}): Jobs {
  const log = options.log ?? (() => undefined);
  const pool = new pg.Pool({ connectionString: options.databaseUrl, max: 1 });
  pool.on('error', (error) => {
    log(`jobs: ${error.message}`);
  });
  const run = async (what: string, sql: string) => {
    try {
      await pool.query(sql);
    } catch (error) {
      log(`jobs: ${what} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const expire = () => run('expiry', 'SELECT relay.expire_orders()');
  const purge = async () => {
    await run('retention', 'SELECT relay.purge()');
    await run('bill retention', 'SELECT relay.purge_table_bills()');
  };
  const expiring = setInterval(() => void expire(), options.expireEveryMs ?? 60_000);
  const purging = setInterval(() => void purge(), options.purgeEveryMs ?? 3_600_000);
  expiring.unref();
  purging.unref();
  return {
    async runNow() {
      await expire();
      await purge();
    },
    async stop() {
      clearInterval(expiring);
      clearInterval(purging);
      await pool.end();
    },
  };
}
