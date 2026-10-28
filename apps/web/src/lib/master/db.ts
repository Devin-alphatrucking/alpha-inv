import { pool } from "@alpha/db";
import { rawDb } from "@/lib/db";

type Tx = Parameters<Parameters<typeof rawDb.$transaction>[0]>[0];

/**
 * Cross-company access for the master console ONLY. Runs `fn` in one transaction that says "this is the platform"
 * (app.platform = on). The database policies added in migration 20261026090000 then let that transaction READ
 * support tickets, activity and error logs and projects of every company, and change ticket status, and nothing else.
 * Never call this from company code; every caller must first pass requirePlatformAdmin().
 */
export async function platformTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return rawDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.platform', 'on', true)`;
    return fn(tx);
  });
}

/**
 * The same platform-only read as platformTx, straight through the connection pool. For the console's big list queries:
 * Prisma turns every cell of a large raw result into objects one by one, which took 5 to 10 times longer than the database
 * itself. Pass SQL with $1, $2 placeholders. Timestamps must be selected as ("column" AT TIME ZONE 'UTC') so they arrive as the right moment.
 */
export async function platformSql<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('app.platform', 'on', true)");
    const res = await client.query(text, params);
    await client.query("COMMIT");
    return res.rows as T[];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
