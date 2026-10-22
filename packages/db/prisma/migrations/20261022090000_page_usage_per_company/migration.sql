-- Step 2c: page-usage counters and the company cap are now per company.
-- Rename the single global keys to the default company's keys.
UPDATE "PageUsage" SET "scopeKey" = 'ORG:org_default' WHERE "scopeKey" = 'COMPANY';
UPDATE "AppSetting" SET "key" = 'companyMonthlyPageLimit:org_default' WHERE "key" = 'companyMonthlyPageLimit';
