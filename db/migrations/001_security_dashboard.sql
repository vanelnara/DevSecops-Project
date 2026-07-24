-- Security dashboard schema (extends existing Jenkins pipeline_runs DB)
-- Apply with: psql -h HOST -U jenkins -d jenkins -f db/migrations/001_security_dashboard.sql

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id            SERIAL PRIMARY KEY,
  job_name      TEXT NOT NULL,
  build_number  INTEGER NOT NULL,
  status        TEXT NOT NULL,
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  finished_at   TIMESTAMPTZ DEFAULT NOW(),
  log_excerpt   TEXT DEFAULT '',
  UNIQUE (job_name, build_number)
);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id                SERIAL PRIMARY KEY,
  job_name          TEXT NOT NULL,
  build_number      INTEGER NOT NULL,
  stage_name        TEXT NOT NULL,
  status            TEXT NOT NULL,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  duration_seconds  INTEGER,
  details           TEXT DEFAULT '',
  UNIQUE (job_name, build_number, stage_name)
);

CREATE TABLE IF NOT EXISTS security_builds (
  id              SERIAL PRIMARY KEY,
  job_name        TEXT NOT NULL,
  build_number    INTEGER NOT NULL,
  branch          TEXT,
  commit_sha      TEXT,
  triggered_by    TEXT,
  status          TEXT NOT NULL,
  risk_score      INTEGER DEFAULT 0,
  duration_seconds INTEGER,
  image_tag       TEXT,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  raw_meta        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (job_name, build_number)
);

CREATE TABLE IF NOT EXISTS findings (
  id            SERIAL PRIMARY KEY,
  job_name      TEXT NOT NULL,
  build_number  INTEGER NOT NULL,
  finding_key   TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title         TEXT NOT NULL,
  source        TEXT NOT NULL,
  asset         TEXT,
  status        TEXT NOT NULL DEFAULT 'open',
  confidence    INTEGER DEFAULT 90,
  raw           JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (job_name, build_number, finding_key, source)
);

CREATE TABLE IF NOT EXISTS ai_analyses (
  id            SERIAL PRIMARY KEY,
  job_name      TEXT NOT NULL,
  build_number  INTEGER NOT NULL,
  verdict       TEXT,
  confidence    INTEGER,
  narrative     TEXT,
  priorities    JSONB DEFAULT '[]'::jsonb,
  model         TEXT,
  raw_response  JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (job_name, build_number)
);

CREATE TABLE IF NOT EXISTS activity_events (
  id            SERIAL PRIMARY KEY,
  job_name      TEXT,
  build_number  INTEGER,
  actor         TEXT NOT NULL,
  action        TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_findings_build ON findings (job_name, build_number);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings (severity);
CREATE INDEX IF NOT EXISTS idx_stages_build ON pipeline_stages (job_name, build_number);
CREATE INDEX IF NOT EXISTS idx_builds_finished ON security_builds (finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events (created_at DESC);
