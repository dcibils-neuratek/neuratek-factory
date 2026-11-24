-- Neuratek Factory. Copyright (c) 2026 Diego Cibils. MIT; see LICENSE.
-- For a database made before 25 November 2026: a project open to everyone
-- (the demo), and setup codes for connecting a coding agent. A database made
-- from schema.sql since has both, and does not run this.
ALTER TABLE projects ADD COLUMN everyone TEXT;

CREATE TABLE IF NOT EXISTS connects (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  hash     TEXT NOT NULL UNIQUE,
  person   INTEGER NOT NULL,
  project  TEXT NOT NULL,
  created  TEXT NOT NULL,
  expires  TEXT NOT NULL,
  used     TEXT,
  key      INTEGER
);
