-- Run ONCE per database as the owner/admin role (replace the password).
-- Creates the ordinary role the web app/API must connect as, so that
-- Row-Level Security is actually enforced. The owner role (used for
-- migrations) is exempt from RLS by design.
--
--   psql "<owner connection string>" -v app_password="'a-long-random-password'" -f app-role.sql
--
-- Then point the app's DATABASE_URL at app_runtime, and keep the owner URL
-- in MIGRATE_DATABASE_URL (used only by `npm run db:deploy` / `db:migrate`).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

ALTER ROLE app_runtime PASSWORD :app_password;

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
-- tables/sequences created by FUTURE migrations (run as the owner) are covered too
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
-- the app must never touch Prisma's migration bookkeeping
REVOKE ALL ON "_prisma_migrations" FROM app_runtime;
