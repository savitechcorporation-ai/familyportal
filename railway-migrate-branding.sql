-- FamilyPortal — add white-label branding columns to schools
-- Run this once against the existing Railway Postgres database
-- (railway-init.sql already has the correct schema for fresh installs;
--  this migrates a database that was created before this change).
--
-- Images are stored as bytea directly in Postgres (not on local disk) -
-- Render's filesystem is ephemeral and wiped on every redeploy, so this is
-- the only storage choice here that actually survives a deploy.

BEGIN;

ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo BYTEA;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_content_type TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS banner BYTEA;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS banner_content_type TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS primary_color TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS accent_color TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS branding_updated_at TIMESTAMP;

COMMIT;
