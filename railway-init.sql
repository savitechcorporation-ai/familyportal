-- FamilyPortal — Railway PostgreSQL initialization
-- Schema derived from the queries in familyportal-backend-pro.js
-- (Railway DB was empty; this rebuilds the tables the backend code requires,
--  plus a demo admin account matching the login form on admin-dashboard.html.)

BEGIN;

CREATE TABLE IF NOT EXISTS schools (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- No UNIQUE(school_id, email): each child gets a fully separate login row,
-- so the same parent email can legitimately appear on multiple rows (one per
-- child). Uniqueness for a specific login comes from email + the linked
-- student's student_number, resolved in the /api/login query, not from a
-- DB constraint on this table.
CREATE TABLE IF NOT EXISTS users (
  id        SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  name      TEXT NOT NULL,
  email     TEXT NOT NULL,
  password  TEXT NOT NULL,
  phone     TEXT,
  role      TEXT NOT NULL CHECK (role IN ('admin', 'parent', 'teacher'))
);

CREATE TABLE IF NOT EXISTS students (
  id             SERIAL PRIMARY KEY,
  school_id      INTEGER NOT NULL REFERENCES schools(id),
  parent_id      INTEGER REFERENCES users(id),
  name           TEXT NOT NULL,
  grade_level    TEXT,
  section        TEXT,
  photo          TEXT,
  student_number TEXT,
  adviser        TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  UNIQUE (school_id, student_number)
);

-- Quarters are real rows (not columns) so each one can carry its own
-- release status - the parent portal only shows a quarter once it's
-- status = 'released'.
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

CREATE TABLE IF NOT EXISTS subjects (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER NOT NULL REFERENCES schools(id),
  grade_level  TEXT NOT NULL,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  teacher_name TEXT,
  UNIQUE (school_id, grade_level, code)
);

CREATE TABLE IF NOT EXISTS grades (
  id           SERIAL PRIMARY KEY,
  student_id   INTEGER NOT NULL REFERENCES students(id),
  quarter_id   INTEGER NOT NULL REFERENCES quarters(id),
  subject_code TEXT NOT NULL,
  score        NUMERIC,
  UNIQUE (student_id, quarter_id, subject_code)
);

CREATE TABLE IF NOT EXISTS attendance (
  id          SERIAL PRIMARY KEY,
  student_id  INTEGER NOT NULL REFERENCES students(id),
  quarter_id  INTEGER NOT NULL REFERENCES quarters(id),
  present     INTEGER,
  absent      INTEGER,
  tardy       INTEGER,
  school_days INTEGER,
  UNIQUE (student_id, quarter_id)
);

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

CREATE TABLE IF NOT EXISTS announcements (
  id        SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  title     TEXT NOT NULL,
  message   TEXT,
  date      DATE NOT NULL DEFAULT CURRENT_DATE
);

-- Demo school (School ID 1, matching the login form on admin-dashboard.html)
INSERT INTO schools (id, name, created_at)
VALUES (1, 'QCC School', NOW())
ON CONFLICT (id) DO NOTHING;

-- Keep the id sequence in sync since id=1 was inserted explicitly
SELECT setval('schools_id_seq', GREATEST((SELECT MAX(id) FROM schools), 1));

-- Demo admin account
-- Password: admin123 (bcrypt hash, cost 10 — generated with this project's own
-- bcryptjs to match hashPassword()/verifyPassword() in familyportal-backend-pro.js)
-- (No UNIQUE constraint to target for ON CONFLICT anymore, so guard with NOT EXISTS instead.)
INSERT INTO users (school_id, name, email, password, role)
SELECT 1, 'Admin', 'admin@qcc-school.edu.ph',
       '$2a$10$rRW3TqK30qJxm1nrWbs5Xuw3h6TdIl55o4dDioRRukEjGKvtfcQ0q', 'admin'
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE school_id = 1 AND email = 'admin@qcc-school.edu.ph'
);

-- Default quarters for the demo school year
INSERT INTO quarters (school_id, school_year, label, short, sort_order)
SELECT 1, '2026-2027', label, short, sort_order
FROM (VALUES
  ('Quarter 1', 'Q1', 1),
  ('Quarter 2', 'Q2', 2),
  ('Quarter 3', 'Q3', 3),
  ('Quarter 4', 'Q4', 4)
) AS q(label, short, sort_order)
ON CONFLICT (school_id, school_year, sort_order) DO NOTHING;

-- Default DepEd subject lists: elementary (Preschool-Grade 6), junior high
-- (Grade 7-10, adds TLE). Grade 11-12 seeded with the junior-high list as a
-- placeholder - real Senior High subjects vary by strand and aren't covered
-- here yet.
INSERT INTO subjects (school_id, grade_level, code, name)
SELECT 1, gl, code, name
FROM (VALUES
  ('Preschool'), ('Kinder 1'), ('Kinder 2'),
  ('Grade 1'), ('Grade 2'), ('Grade 3'), ('Grade 4'), ('Grade 5'), ('Grade 6')
) AS elem(gl)
CROSS JOIN (VALUES
  ('FIL', 'Filipino'), ('ENG', 'English'), ('MATH', 'Mathematics'), ('SCI', 'Science'),
  ('AP', 'Araling Panlipunan'), ('ESP', 'Edukasyon sa Pagpapakatao'), ('MAPEH', 'MAPEH')
) AS subj(code, name)
ON CONFLICT (school_id, grade_level, code) DO NOTHING;

INSERT INTO subjects (school_id, grade_level, code, name)
SELECT 1, gl, code, name
FROM (VALUES
  ('Grade 7'), ('Grade 8'), ('Grade 9'), ('Grade 10'), ('Grade 11'), ('Grade 12')
) AS jhs(gl)
CROSS JOIN (VALUES
  ('FIL', 'Filipino'), ('ENG', 'English'), ('MATH', 'Mathematics'), ('SCI', 'Science'),
  ('AP', 'Araling Panlipunan'), ('ESP', 'Edukasyon sa Pagpapakatao'), ('MAPEH', 'MAPEH'), ('TLE', 'TLE')
) AS subj(code, name)
ON CONFLICT (school_id, grade_level, code) DO NOTHING;

COMMIT;
