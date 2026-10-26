-- Phase 11: more roles. STAFF and ADMIN stay as they are; the new values are only added (a database cannot use a new value in the same step that adds it, and nothing here does).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ACCOUNTANT';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PURCHASE';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MANAGER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ENGINEER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'VIEWER';
