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
