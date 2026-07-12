-- FamilyPortal — migrate to quarters/subjects schema (Admin Portal Phase 1)
-- Run this ONCE against the existing Railway Postgres database.
-- (railway-init.sql already has the correct schema for fresh installs;
--  this migrates a database that was created before this change.)
--
-- What this does:
--   1. Widens users.role to allow 'teacher', adds users.phone
--   2. Adds students.adviser and students.status
--   3. Creates quarters, subjects, remarks, values_ratings
--   4. Migrates existing grades (q1-q4 columns) into quarter-based rows,
--      renaming the old table to grades_legacy (kept, not deleted)
--   5. Renames attendance to attendance_legacy (kept, not deleted) and
--      starts a fresh, empty quarter-based attendance table - old
--      attendance was month-based with no reliable month->quarter mapping,
--      so it isn't auto-migrated; re-enter it under the new model going
--      forward.
--
-- Seeded quarters are marked 'released' (not the schema default
-- 'not_started') so grades/attendance already visible to parents under the
-- old system don't suddenly disappear once release-gating is enforced.

BEGIN;

-- 1. users: teacher role + phone
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'parent', 'teacher'));

-- 2. students: adviser + status
ALTER TABLE students ADD COLUMN IF NOT EXISTS adviser TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_status_check;
ALTER TABLE students ADD CONSTRAINT students_status_check CHECK (status IN ('active', 'inactive'));

-- 3. quarters
CREATE TABLE IF NOT EXISTS quarters (
  id          SERIAL PRIMARY KEY,
  school_id   INTEGER NOT NULL REFERENCES schools(id),
  school_year TEXT NOT NULL,
  label       TEXT NOT NULL,
  short       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'released')),
  UNIQUE (school_id, school_year, sort_order)
);

INSERT INTO quarters (school_id, school_year, label, short, sort_order, status)
SELECT s.id, '2026-2027', q.label, q.short, q.sort_order, 'released'
FROM schools s
CROSS JOIN (VALUES
  ('Quarter 1', 'Q1', 1),
  ('Quarter 2', 'Q2', 2),
  ('Quarter 3', 'Q3', 3),
  ('Quarter 4', 'Q4', 4)
) AS q(label, short, sort_order)
ON CONFLICT (school_id, school_year, sort_order) DO NOTHING;

-- 4. subjects (elementary set for Preschool-Grade 6, junior-high set adds TLE
--    for Grade 7-10; Grade 11-12 seeded with the junior-high list as a
--    placeholder pending real Senior High track subjects)
CREATE TABLE IF NOT EXISTS subjects (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER NOT NULL REFERENCES schools(id),
  grade_level  TEXT NOT NULL,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  teacher_name TEXT,
  UNIQUE (school_id, grade_level, code)
);

INSERT INTO subjects (school_id, grade_level, code, name)
SELECT s.id, gl.gl, subj.code, subj.name
FROM schools s
CROSS JOIN (VALUES
  ('Preschool'), ('Kinder 1'), ('Kinder 2'),
  ('Grade 1'), ('Grade 2'), ('Grade 3'), ('Grade 4'), ('Grade 5'), ('Grade 6')
) AS gl(gl)
CROSS JOIN (VALUES
  ('FIL', 'Filipino'), ('ENG', 'English'), ('MATH', 'Mathematics'), ('SCI', 'Science'),
  ('AP', 'Araling Panlipunan'), ('ESP', 'Edukasyon sa Pagpapakatao'), ('MAPEH', 'MAPEH')
) AS subj(code, name)
ON CONFLICT (school_id, grade_level, code) DO NOTHING;

INSERT INTO subjects (school_id, grade_level, code, name)
SELECT s.id, gl.gl, subj.code, subj.name
FROM schools s
CROSS JOIN (VALUES
  ('Grade 7'), ('Grade 8'), ('Grade 9'), ('Grade 10'), ('Grade 11'), ('Grade 12')
) AS gl(gl)
CROSS JOIN (VALUES
  ('FIL', 'Filipino'), ('ENG', 'English'), ('MATH', 'Mathematics'), ('SCI', 'Science'),
  ('AP', 'Araling Panlipunan'), ('ESP', 'Edukasyon sa Pagpapakatao'), ('MAPEH', 'MAPEH'), ('TLE', 'TLE')
) AS subj(code, name)
ON CONFLICT (school_id, grade_level, code) DO NOTHING;

-- 5. remarks, values_ratings
CREATE TABLE IF NOT EXISTS remarks (
  id         SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  quarter_id INTEGER NOT NULL REFERENCES quarters(id),
  body       TEXT,
  UNIQUE (student_id, quarter_id)
);

CREATE TABLE IF NOT EXISTS values_ratings (
  id         SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  quarter_id INTEGER NOT NULL REFERENCES quarters(id),
  core_value TEXT NOT NULL,
  rating     TEXT CHECK (rating IN ('AO', 'SO', 'RO', 'NO')),
  UNIQUE (student_id, quarter_id, core_value)
);

-- 6. grades: migrate q1-q4 columns into quarter rows
ALTER TABLE grades RENAME TO grades_legacy;

CREATE TABLE grades (
  id           SERIAL PRIMARY KEY,
  student_id   INTEGER NOT NULL REFERENCES students(id),
  quarter_id   INTEGER NOT NULL REFERENCES quarters(id),
  subject_code TEXT NOT NULL,
  score        NUMERIC,
  UNIQUE (student_id, quarter_id, subject_code)
);

-- subject_code is whatever free-text subject name was already used in
-- grades_legacy - it isn't a foreign key against subjects.code, so this is
-- safe even where names don't exactly match the seeded canonical list.
INSERT INTO grades (student_id, quarter_id, subject_code, score)
SELECT gl.student_id, q.id, gl.subject, gl.q1
FROM grades_legacy gl
JOIN students st ON st.id = gl.student_id
JOIN quarters q ON q.school_id = st.school_id AND q.school_year = gl.school_year AND q.sort_order = 1
WHERE gl.q1 IS NOT NULL
ON CONFLICT (student_id, quarter_id, subject_code) DO NOTHING;

INSERT INTO grades (student_id, quarter_id, subject_code, score)
SELECT gl.student_id, q.id, gl.subject, gl.q2
FROM grades_legacy gl
JOIN students st ON st.id = gl.student_id
JOIN quarters q ON q.school_id = st.school_id AND q.school_year = gl.school_year AND q.sort_order = 2
WHERE gl.q2 IS NOT NULL
ON CONFLICT (student_id, quarter_id, subject_code) DO NOTHING;

INSERT INTO grades (student_id, quarter_id, subject_code, score)
SELECT gl.student_id, q.id, gl.subject, gl.q3
FROM grades_legacy gl
JOIN students st ON st.id = gl.student_id
JOIN quarters q ON q.school_id = st.school_id AND q.school_year = gl.school_year AND q.sort_order = 3
WHERE gl.q3 IS NOT NULL
ON CONFLICT (student_id, quarter_id, subject_code) DO NOTHING;

INSERT INTO grades (student_id, quarter_id, subject_code, score)
SELECT gl.student_id, q.id, gl.subject, gl.q4
FROM grades_legacy gl
JOIN students st ON st.id = gl.student_id
JOIN quarters q ON q.school_id = st.school_id AND q.school_year = gl.school_year AND q.sort_order = 4
WHERE gl.q4 IS NOT NULL
ON CONFLICT (student_id, quarter_id, subject_code) DO NOTHING;

-- 7. attendance: preserve old month-based data, start a fresh quarter-based table
ALTER TABLE attendance RENAME TO attendance_legacy;

CREATE TABLE attendance (
  id          SERIAL PRIMARY KEY,
  student_id  INTEGER NOT NULL REFERENCES students(id),
  quarter_id  INTEGER NOT NULL REFERENCES quarters(id),
  present     INTEGER,
  absent      INTEGER,
  tardy       INTEGER,
  school_days INTEGER,
  UNIQUE (student_id, quarter_id)
);

COMMIT;
