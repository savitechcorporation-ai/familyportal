-- FamilyPortal — drop UNIQUE(school_id, email) on users
-- Run this once against the existing Railway Postgres database
-- (railway-init.sql already has the correct schema for fresh installs;
--  this migrates a database that was created before that change).
--
-- Each child now gets a fully separate login row, so the same parent email
-- can legitimately appear on multiple rows (one per child). Uniqueness for
-- a specific login is enforced by the /api/login query (email + the linked
-- student's student_number), not by a DB constraint on this table.
--
-- Postgres auto-named this constraint users_school_id_email_key when it was
-- created inline in the original CREATE TABLE statement. If this DROP fails
-- because the name differs, run \d users in the console to find the actual
-- name and substitute it below.

BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_school_id_email_key;

COMMIT;
