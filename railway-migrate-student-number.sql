-- FamilyPortal — add student_number to students
-- Run this once against the existing Railway Postgres database
-- (railway-init.sql already has the correct schema for fresh installs;
--  this migrates a database that was created before that change).

BEGIN;

ALTER TABLE students ADD COLUMN IF NOT EXISTS student_number TEXT;
ALTER TABLE students ADD CONSTRAINT students_school_student_number_unique UNIQUE (school_id, student_number);

COMMIT;
