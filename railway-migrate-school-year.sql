-- FamilyPortal — add school_year to grades and attendance
-- Run this once against the existing Railway Postgres database
-- (railway-init.sql already has the correct schema for fresh installs;
--  this migrates a database that was created before that change).

BEGIN;

-- Adds the column with a default, which backfills every existing row to '2026-2027'
ALTER TABLE grades ADD COLUMN IF NOT EXISTS school_year TEXT NOT NULL DEFAULT '2026-2027';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS school_year TEXT NOT NULL DEFAULT '2026-2027';

-- grades had no DB-level uniqueness before (only enforced in application code) — add it now
ALTER TABLE grades ADD CONSTRAINT grades_student_subject_year_unique UNIQUE (student_id, subject, school_year);

-- attendance's old UNIQUE (student_id, month) must be replaced — Postgres auto-named it
-- attendance_student_id_month_key when it was created inline in the CREATE TABLE statement.
-- If this DROP fails because the name differs, run \d attendance in the console to find the
-- actual constraint name and substitute it below.
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_student_id_month_key;
ALTER TABLE attendance ADD CONSTRAINT attendance_student_month_year_unique UNIQUE (student_id, month, school_year);

COMMIT;
