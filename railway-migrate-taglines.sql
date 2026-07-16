-- FamilyPortal — add per-portal login taglines to schools
-- Run this once against the existing Railway Postgres database
-- (railway-init.sql already has the correct schema for fresh installs;
--  this migrates a database that was created before this change).
--
-- Lets the login header subtitle be configured per portal instead of
-- hardcoded: admin_portal_tagline for admin-dashboard.html's login,
-- parent_portal_tagline for parent-portal.html's login. Both are read by
-- GET /api/branding and NULL falls back to each portal's built-in default
-- text client-side, so this migration does not require backfilling values.

BEGIN;

ALTER TABLE schools ADD COLUMN IF NOT EXISTS admin_portal_tagline TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS parent_portal_tagline TEXT;

COMMIT;
