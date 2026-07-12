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

CREATE TABLE IF NOT EXISTS users (
  id        SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  name      TEXT NOT NULL,
  email     TEXT NOT NULL,
  password  TEXT NOT NULL,
  role      TEXT NOT NULL CHECK (role IN ('admin', 'parent')),
  UNIQUE (school_id, email)
);

CREATE TABLE IF NOT EXISTS students (
  id          SERIAL PRIMARY KEY,
  school_id   INTEGER NOT NULL REFERENCES schools(id),
  parent_id   INTEGER REFERENCES users(id),
  name        TEXT NOT NULL,
  grade_level TEXT,
  section     TEXT,
  photo       TEXT
);

CREATE TABLE IF NOT EXISTS grades (
  id         SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  subject    TEXT NOT NULL,
  q1         NUMERIC,
  q2         NUMERIC,
  q3         NUMERIC,
  q4         NUMERIC
);

CREATE TABLE IF NOT EXISTS attendance (
  id           SERIAL PRIMARY KEY,
  student_id   INTEGER NOT NULL REFERENCES students(id),
  month        TEXT NOT NULL,
  present_days INTEGER,
  absent_days  INTEGER,
  tardy_days   INTEGER,
  UNIQUE (student_id, month)
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
INSERT INTO users (school_id, name, email, password, role)
VALUES (
  1,
  'Admin',
  'admin@qcc-school.edu.ph',
  '$2a$10$rRW3TqK30qJxm1nrWbs5Xuw3h6TdIl55o4dDioRRukEjGKvtfcQ0q',
  'admin'
)
ON CONFLICT (school_id, email) DO NOTHING;

COMMIT;
