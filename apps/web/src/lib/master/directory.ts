import { cache } from "react";
import { platformSql } from "./db";

/**
 * Every company with the numbers the master console lists, in ONE query and one round trip (the console used to ask the
 * database six separate questions, twice per page). Cached for the length of one request, so the overview, the list and
 * the company page can all use it without asking again.
 */

export const DIRECTORY_CAP = 5000;

export type DirectoryRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  subStatus: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | null;
  quantity: number | null;
  billing: string | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  graceEndsAt: Date | null;
  trialEndingNoticeAt: Date | null;
  trialEndedNoticeAt: Date | null;
  members: number;
  projects: number;
  lastActiveAt: Date | null;
  openTickets: number;
};

export const loadDirectory = cache(async (): Promise<DirectoryRow[]> =>
  platformSql<DirectoryRow>(
    `SELECT o.id, o.name, o.slug, o.status::text AS status, (o."createdAt" AT TIME ZONE 'UTC') AS "createdAt",
            s.status::text AS "subStatus", s.quantity, s.billing,
            (s."trialEndsAt" AT TIME ZONE 'UTC') AS "trialEndsAt", (s."currentPeriodEnd" AT TIME ZONE 'UTC') AS "currentPeriodEnd", (s."graceEndsAt" AT TIME ZONE 'UTC') AS "graceEndsAt",
            (s."trialEndingNoticeAt" AT TIME ZONE 'UTC') AS "trialEndingNoticeAt", (s."trialEndedNoticeAt" AT TIME ZONE 'UTC') AS "trialEndedNoticeAt",
            (SELECT count(*) FROM "Membership" m WHERE m."organizationId" = o.id)::int AS members,
            (SELECT count(*) FROM "Project" p WHERE p."organizationId" = o.id AND p.status = 'ACTIVE')::int AS projects,
            (o."lastActiveAt" AT TIME ZONE 'UTC') AS "lastActiveAt",
            (SELECT count(*) FROM "SupportTicket" t WHERE t."organizationId" = o.id AND t.status <> 'RESOLVED')::int AS "openTickets"
     FROM "Organization" o
     LEFT JOIN "Subscription" s ON s."organizationId" = o.id
     ORDER BY o."createdAt" DESC
     LIMIT $1`,
    [DIRECTORY_CAP],
  ),
);

const MODULE_USE_TTL_MS = 60_000;
const moduleUseMemo = new Map<number, { at: number; value: Record<string, number> }>();

/**
 * What the companies did in the last `days` days: for each part of the product, how many companies used it. This reads a
 * month of the activity log, so the answer is kept for a minute (it is a trend, not a live number).
 */
export async function loadModuleUse(days = 30): Promise<Record<string, number>> {
  const hit = moduleUseMemo.get(days);
  if (hit && Date.now() - hit.at < MODULE_USE_TTL_MS) return hit.value;
  const rows = await platformSql<{ module: string; companies: number }>(
    `SELECT module, count(DISTINCT "organizationId")::int AS companies
     FROM "ActivityLog"
     WHERE "createdAt" >= now() - make_interval(days => $1) AND "organizationId" IS NOT NULL AND module IN ('INVOICE', 'PAYMENT', 'VENDOR', 'SITE', 'PURCHASE')
     GROUP BY module`,
    [days],
  );
  const value = Object.fromEntries(rows.map((r) => [r.module, r.companies]));
  moduleUseMemo.set(days, { at: Date.now(), value });
  return value;
}
