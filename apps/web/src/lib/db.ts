// The database lives in the shared @alpha/db package.
//
// `rawDb` is NOT company-scoped. Only use it for tables that are not owned by
// a company (User, Membership, Organization, AppSetting, PageUsage), the
// sign-in flow, and the activity/error loggers. Everything else must go through
// `dbFor(orgId)` / `requireOrgDb()` / `pageOrg()` / `scoped(user)`
// (see docs/PHASE-2-COMPANIES.md, step 2c).
export { db as rawDb } from "@alpha/db";
