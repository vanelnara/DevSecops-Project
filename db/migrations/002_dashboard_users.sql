-- Dashboard users, sessions, and per-user saved state
-- Apply with: psql -h 127.0.0.1 -U jenkins -d jenkins -f db/migrations/002_dashboard_users.sql

CREATE TABLE IF NOT EXISTS dashboard_users (
  id               SERIAL PRIMARY KEY,
  username         TEXT NOT NULL UNIQUE,
  email            TEXT NOT NULL UNIQUE,
  password_hash    TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  theme_preference TEXT NOT NULL DEFAULT 'system'
                   CHECK (theme_preference IN ('system', 'dark', 'light')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dashboard_sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_user
  ON dashboard_sessions (user_id);

CREATE TABLE IF NOT EXISTS user_finding_states (
  user_id     INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
  finding_id  INTEGER NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  status      TEXT NOT NULL
              CHECK (status IN ('open', 'triage', 'in-progress', 'accepted', 'resolved', 'false-positive')),
  notes       TEXT DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, finding_id)
);

CREATE TABLE IF NOT EXISTS user_chat_messages (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
  job_name      TEXT,
  build_number  INTEGER,
  role          TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content       TEXT NOT NULL,
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_chat_user_created
  ON user_chat_messages (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_activity (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_created
  ON user_activity (user_id, created_at DESC);
