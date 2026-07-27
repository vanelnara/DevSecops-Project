#!/usr/bin/env bash
# Log pipeline stage results to PostgreSQL (called from Jenkinsfile)
set -euo pipefail

JOB_NAME="${1:-unknown}"
BUILD_NUMBER="${2:-0}"
STAGE_NAME="${3:-unknown}"
STATUS="${4:-UNKNOWN}"
DETAILS="${5:-}"
DURATION_SECONDS="${6:-}"

PGHOST="${JENKINS_DB_HOST:-127.0.0.1}"
PGPORT="${JENKINS_DB_PORT:-5432}"
PGDATABASE="${JENKINS_DB_NAME:-jenkins}"
PGUSER="${JENKINS_DB_USER:-jenkins}"
PGPASSWORD="${JENKINS_DB_PASSWORD:?JENKINS_DB_PASSWORD required}"

export PGPASSWORD

DETAILS_ESCAPED="${DETAILS//\'/\'\'}"
STAGE_ESCAPED="${STAGE_NAME//\'/\'\'}"
STATUS_ESCAPED="${STATUS//\'/\'\'}"
JOB_ESCAPED="${JOB_NAME//\'/\'\'}"

DURATION_SQL="NULL"
if [ -n "${DURATION_SECONDS}" ]; then
  DURATION_SQL="${DURATION_SECONDS}"
fi

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 <<SQL
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

INSERT INTO pipeline_runs (job_name, build_number, status, started_at, finished_at, log_excerpt)
VALUES (
  '${JOB_ESCAPED}',
  ${BUILD_NUMBER},
  '${STATUS_ESCAPED}',
  NOW(),
  NOW(),
  '[${STAGE_ESCAPED}] ${DETAILS_ESCAPED}'
)
ON CONFLICT (job_name, build_number) DO UPDATE
SET status = EXCLUDED.status,
    finished_at = NOW(),
    log_excerpt = pipeline_runs.log_excerpt || E'\n' || EXCLUDED.log_excerpt;

INSERT INTO pipeline_stages (
  job_name, build_number, stage_name, status, started_at, finished_at, duration_seconds, details
) VALUES (
  '${JOB_ESCAPED}',
  ${BUILD_NUMBER},
  '${STAGE_ESCAPED}',
  '${STATUS_ESCAPED}',
  CASE WHEN '${STATUS_ESCAPED}' = 'STARTED' THEN NOW() ELSE NULL END,
  CASE WHEN '${STATUS_ESCAPED}' = 'STARTED' THEN NULL ELSE NOW() END,
  ${DURATION_SQL},
  '${DETAILS_ESCAPED}'
)
ON CONFLICT (job_name, build_number, stage_name) DO UPDATE
SET status = EXCLUDED.status,
    started_at = COALESCE(pipeline_stages.started_at, EXCLUDED.started_at),
    finished_at = COALESCE(EXCLUDED.finished_at, pipeline_stages.finished_at),
    duration_seconds = COALESCE(
      EXCLUDED.duration_seconds,
      CASE
        WHEN pipeline_stages.started_at IS NOT NULL AND EXCLUDED.finished_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (EXCLUDED.finished_at - pipeline_stages.started_at))::int
        ELSE pipeline_stages.duration_seconds
      END
    ),
    details = CASE
      WHEN EXCLUDED.details = '' THEN pipeline_stages.details
      ELSE EXCLUDED.details
    END;
SQL
