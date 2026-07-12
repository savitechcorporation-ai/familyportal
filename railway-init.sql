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
  role      TEXT NOT NULL CHECK (role IN ('admin', 'parent'))
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
  UNIQUE (school_id, student_number)
);

CREATE TABLE IF NOT EXISTS grades (
  id          SERIAL PRIMARY KEY,
  student_id  INTEGER NOT NULL REFERENCES students(id),
  subject     TEXT NOT NULL,
  school_year TEXT NOT NULL DEFAULT '2026-2027',
  q1          NUMERIC,
  q2          NUMERIC,
  q3          NUMERIC,
  q4          NUMERIC,
  UNIQUE (student_id, subject, school_year)
);

CREATE TABLE IF NOT EXISTS attendance (
  id           SERIAL PRIMARY KEY,
  student_id   INTEGER NOT NULL REFERENCES students(id),
  month        TEXT NOT NULL,
  school_year  TEXT NOT NULL DEFAULT '2026-2027',
  present_days INTEGER,
  absent_days  INTEGER,
  tardy_days   INTEGER,
  UNIQUE (student_id, month, school_year)
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

COMMIT;
