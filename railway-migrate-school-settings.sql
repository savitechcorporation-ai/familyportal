-- FamilyPortal — add address/director/registrar to schools (Admin Portal Phase 2)
-- Run this once against the existing Railway Postgres database
-- (railway-init.sql already has the correct schema for fresh installs;
--  this migrates a database that was created before this change).

BEGIN;

ALTER TABLE schools ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS director TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS registrar TEXT;

COMMIT;
