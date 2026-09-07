-- Foods per group
CREATE TABLE IF NOT EXISTS foods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(chat_id, name)
);

-- Lunch sessions
CREATE TABLE IF NOT EXISTS lunch_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  message_id INTEGER,                      -- telegram message id to edit
  status TEXT NOT NULL DEFAULT 'REGISTRATION',
  -- REGISTRATION | LOCKED | VOTING | COMPLETED
  registration_deadline INTEGER NOT NULL,  -- unix timestamp 11:11
  current_food_id INTEGER,                 -- food being voted on right now
  current_round INTEGER NOT NULL DEFAULT 0,
  vote_deadline INTEGER,                   -- unix timestamp, vote expires
  result TEXT,                             -- WINNER | NO_FOOD
  winner_food_id INTEGER,
  eaters_count INTEGER NOT NULL DEFAULT 0, -- cached count
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_lunch_sessions_chat_status
  ON lunch_sessions(chat_id, status);

-- Registration: each user joins or not
CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES lunch_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  user_name TEXT,
  eating INTEGER NOT NULL DEFAULT 1,  -- 1 = eating, 0 = not eating
  UNIQUE(session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_registrations_session
  ON registrations(session_id);

-- Per-round food votes
CREATE TABLE IF NOT EXISTS food_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES lunch_sessions(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  food_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  vote INTEGER NOT NULL,  -- 1 = yes, 0 = no
  UNIQUE(session_id, round_number, user_id)
);

CREATE INDEX IF NOT EXISTS idx_food_votes_session_round
  ON food_votes(session_id, round_number);

-- Track rejected foods per session
CREATE TABLE IF NOT EXISTS session_rejected_foods (
  session_id INTEGER NOT NULL REFERENCES lunch_sessions(id) ON DELETE CASCADE,
  food_id INTEGER NOT NULL,
  PRIMARY KEY (session_id, food_id)
);
