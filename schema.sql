-- Neuratek Factory. Copyright (c) 2026 Diego Cibils. MIT; see LICENSE.
-- The Factory's tables, in Cloudflare's D1 (SQLite). One database for every
-- project: a card, a queue entry, a discussion, a decision, a change and
-- what Claude is doing all belong to one project. Notes, messages and files
-- belong to their card or discussion, and so to its project.

-- A person: one of Neuratek's people, known by the Google account they
-- sign in with through Cloudflare Access. `handle` is what @mentions them
-- (their address before the @). An admin makes projects, adds people to
-- them and reaches every project. Someone who signs in and is not here yet
-- is added, belonging to no project until an admin adds them to one.
CREATE TABLE IF NOT EXISTS people (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  email     TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  handle    TEXT NOT NULL UNIQUE,
  admin     INTEGER NOT NULL DEFAULT 0,
  created   TEXT NOT NULL,
  seen      TEXT,                            -- last signed in or used a key
  removed   TEXT                             -- set when they leave: nothing of theirs answers
);

-- Who belongs to which project, and as what: a member edits, a viewer reads.
CREATE TABLE IF NOT EXISTS members (
  project  TEXT NOT NULL,
  person   INTEGER NOT NULL,
  role     TEXT NOT NULL,                    -- member viewer
  added    TEXT NOT NULL,
  added_by TEXT NOT NULL,
  PRIMARY KEY (project, person)
);

CREATE INDEX IF NOT EXISTS members_person ON members (person);

-- A project: what a board is for. `id` is its short name in the API's
-- paths (`/api/p/kosmos/cards`), lower case, letters, digits and dashes.
CREATE TABLE IF NOT EXISTS projects (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  detail    TEXT NOT NULL DEFAULT '',
  rank      REAL NOT NULL DEFAULT 0,       -- its place in the switcher
  created   TEXT NOT NULL,
  author    TEXT NOT NULL,
  archived  TEXT                           -- set when put away; kept
);

-- A card: one thing asked for, agreed, being built or done.
CREATE TABLE IF NOT EXISTS cards (
  id          TEXT PRIMARY KEY,
  project     TEXT NOT NULL,
  title       TEXT NOT NULL,
  col         TEXT NOT NULL,               -- ideas agreed next building done parked
  rank        REAL NOT NULL DEFAULT 0,     -- its place in its column, lowest first
  area        TEXT NOT NULL DEFAULT '',
  ref         TEXT NOT NULL DEFAULT '',    -- a step in the project's plan: "Mail M6", "N12"
  detail      TEXT NOT NULL DEFAULT '',
  quote       TEXT NOT NULL DEFAULT '',    -- the words it was asked in
  asked       TEXT NOT NULL DEFAULT '',    -- the day it was asked or agreed
  in_roadmap  INTEGER NOT NULL DEFAULT 1,  -- 0 until written into the project's own plan
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL,
  updated_by  TEXT NOT NULL DEFAULT '',
  removed     TEXT,                         -- set when removed; kept
  discussion  INTEGER                       -- the discussion it came from, if one
);

CREATE INDEX IF NOT EXISTS cards_col ON cards (project, col, rank);

-- Who a card is for: none, one or several people.
CREATE TABLE IF NOT EXISTS owners (
  card    TEXT NOT NULL,
  person  INTEGER NOT NULL,
  PRIMARY KEY (card, person)
);

CREATE INDEX IF NOT EXISTS owners_person ON owners (person);

-- A note on a card, signed by the key that wrote it.
CREATE TABLE IF NOT EXISTS notes (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  card  TEXT NOT NULL,
  text  TEXT NOT NULL,
  author TEXT NOT NULL,
  at    TEXT NOT NULL,
  asks  INTEGER NOT NULL DEFAULT 0,         -- Claude asking something: a reply is awaited
  agent INTEGER NOT NULL DEFAULT 0,         -- written by an agent's key
  asks_of INTEGER                           -- whose reply: the person the agent works for
);

CREATE INDEX IF NOT EXISTS notes_card ON notes (card, at);

-- A question for a person, on a card or on none, and the answer.
CREATE TABLE IF NOT EXISTS decisions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  project   TEXT NOT NULL,
  card      TEXT,
  question  TEXT NOT NULL,
  options   TEXT NOT NULL DEFAULT '[]',     -- JSON array of strings
  answer    TEXT,                           -- null while open
  words     TEXT NOT NULL DEFAULT '',       -- the answer's words, as said
  asked     TEXT NOT NULL,
  asked_by  TEXT NOT NULL,
  asked_of  INTEGER,                        -- the person who must answer; null: whoever asked's person
  answered  TEXT,
  answered_by TEXT
);

-- Keys, for what does not sign in through a browser: each person's Claude,
-- a script, a device outside Access. Only a key's SHA-256 is kept; the key
-- itself is shown once, when it is made. A key acts for its person and
-- reaches what they reach - narrowed, if `projects` (a JSON list) says so.
-- `agent` marks a Claude's: what it writes is never "waiting for Claude".
CREATE TABLE IF NOT EXISTS keys (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  hash       TEXT NOT NULL UNIQUE,
  person     INTEGER NOT NULL,
  agent      INTEGER NOT NULL DEFAULT 0,
  projects   TEXT,
  created    TEXT NOT NULL,
  last_used  TEXT,
  revoked    TEXT
);

-- Everything that changed, where, and who changed it: what /api/changes reads.
CREATE TABLE IF NOT EXISTS changes (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT,                             -- null for a change to the projects themselves
  at      TEXT NOT NULL,
  author  TEXT NOT NULL,
  kind    TEXT NOT NULL,                    -- card.new card.edit card.move card.remove note decision.new ...
  card    TEXT,
  data    TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS changes_at ON changes (at);
CREATE INDEX IF NOT EXISTS changes_project ON changes (project, at);

-- What each Claude is doing now in a project: one row per project and key,
-- set at each step and read by the strip and the card's mark. `state` is
-- working, waiting or idle; `waiting` says on what - a test run, an answer.
-- `person` is whom it works for: a wait of theirs is in their Needs you.
CREATE TABLE IF NOT EXISTS doing (
  project  TEXT NOT NULL,
  author   TEXT NOT NULL,
  person   INTEGER,
  state    TEXT NOT NULL DEFAULT 'idle',
  card     TEXT,
  step     TEXT NOT NULL DEFAULT '',
  waiting  TEXT NOT NULL DEFAULT '',
  since    TEXT NOT NULL,                  -- when this card was started
  updated  TEXT NOT NULL,                  -- when it was last said
  PRIMARY KEY (project, author)
);

-- Claude's queue in a project: the work plan, in order. An entry is a card
-- from the board or a task that is no card. A queued card is in Next, in
-- the queue's order, and Claude takes the top when the card it is on is done.
CREATE TABLE IF NOT EXISTS queue (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  project   TEXT NOT NULL,
  card      TEXT UNIQUE,                   -- null for a task
  title     TEXT NOT NULL DEFAULT '',      -- a task's words; a card's title is the card's
  rank      REAL NOT NULL,
  added     TEXT NOT NULL,
  added_by  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS queue_project ON queue (project, rank);

-- Discussions: ideas talked through in order before they are cards. A
-- stage - open, shaping, ready, became, parked - the idea in its asker's
-- words and what it is for, a summary Claude keeps, the options with what
-- each gains and costs, the questions still open, and the conversation.
CREATE TABLE IF NOT EXISTS discussions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  project   TEXT NOT NULL,
  title     TEXT NOT NULL,
  idea      TEXT NOT NULL DEFAULT '',
  purpose   TEXT NOT NULL DEFAULT '',
  stage     TEXT NOT NULL DEFAULT 'open',
  summary   TEXT NOT NULL DEFAULT '',
  options   TEXT NOT NULL DEFAULT '[]',     -- [{ name, plus, minus, recommended, chosen }]
  questions TEXT NOT NULL DEFAULT '[]',     -- the questions still open
  created   TEXT NOT NULL,
  author    TEXT NOT NULL,
  updated   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS discussions_project ON discussions (project, updated);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion  INTEGER NOT NULL,
  text        TEXT NOT NULL,
  author      TEXT NOT NULL,
  at          TEXT NOT NULL,
  asks        INTEGER NOT NULL DEFAULT 0,
  agent       INTEGER NOT NULL DEFAULT 0,
  asks_of     INTEGER
);

CREATE INDEX IF NOT EXISTS messages_discussion ON messages (discussion, at);

-- Files on a card or a discussion: screenshots for reference, and what
-- Claude shows of its progress and its finished work. Kept in the database
-- itself, in pieces of 512 KB - D1's rows hold 2 MB - so the Factory needs
-- no second service; at most 15 MB a file. `project` is its owner's, kept
-- here so a file read by its id is checked against the key without a join.
CREATE TABLE IF NOT EXISTS files (
  id          TEXT PRIMARY KEY,
  project     TEXT NOT NULL,
  card        TEXT,
  discussion  INTEGER,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  caption     TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL,
  at          TEXT NOT NULL,
  removed     TEXT
);

CREATE INDEX IF NOT EXISTS files_card ON files (card, at);
CREATE INDEX IF NOT EXISTS files_discussion ON files (discussion, at);

CREATE TABLE IF NOT EXISTS file_pieces (
  file  TEXT NOT NULL,
  n     INTEGER NOT NULL,
  data  BLOB NOT NULL,
  PRIMARY KEY (file, n)
);

-- Someone @mentioned in a note or a message: in their Needs you until they
-- write in that thread, or say they have seen it.
CREATE TABLE IF NOT EXISTS mentions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person      INTEGER NOT NULL,
  project     TEXT NOT NULL,
  card        TEXT,
  discussion  INTEGER,
  text        TEXT NOT NULL,
  author      TEXT NOT NULL,
  at          TEXT NOT NULL,
  done        TEXT
);

CREATE INDEX IF NOT EXISTS mentions_person ON mentions (person, done);
