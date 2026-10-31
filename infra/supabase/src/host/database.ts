import type pg from 'pg';
import type { RelayDatabase, Tx } from '../db.js';

/**
 * The relay functions' database on node-postgres (ADR-0015, ADR-0024). On a self-hosted relay the
 * pool logs in as the functions' own login, `relay_edge`, which can do nothing until a function
 * takes the role of whoever it acts for. Tests use a superuser pool and name the login to act as
 * (`authorization`), as Supabase's functions log in as it.
 *
 * Like postgres.js on Supabase, a statement that fails outside a savepoint fails the whole
 * transaction even when caught, so the functions behave the same on both.
 */
export function pgRelayDatabase(
  pool: pg.Pool,
  options: { readonly authorization?: string } = {},
): RelayDatabase {
  return {
    async transaction(work) {
      const client = await pool.connect();
      let depth = 0;
      let savepoints = 0;
      let uncaught: Error | undefined;
      const tx: Tx = {
        async query<Row extends object>(text: string, params: readonly unknown[] = []) {
          try {
            return (await client.query<Row>(text, [...params])).rows;
          } catch (error) {
            if (depth === 0) uncaught ??= error instanceof Error ? error : new Error(String(error));
            throw error;
          }
        },
        async savepoint(inner) {
          savepoints += 1;
          const name = `sp_${String(savepoints)}`;
          await client.query(`SAVEPOINT ${name}`);
          depth += 1;
          try {
            const value = await inner(tx);
            await client.query(`RELEASE SAVEPOINT ${name}`);
            return value;
          } catch (error) {
            await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
            throw error;
          } finally {
            depth -= 1;
          }
        },
      };
      try {
        await client.query('BEGIN');
        if (options.authorization !== undefined) {
          await client.query(
            `SET LOCAL SESSION AUTHORIZATION ${client.escapeIdentifier(options.authorization)}`,
          );
        }
        const result = await work(tx);
        if (uncaught !== undefined) throw uncaught;
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
