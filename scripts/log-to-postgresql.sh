#!/usr/bin/env bash
# Log pipeline stage results to PostgreSQL (called from Jenkinsfile)
set -euo pipefail

JOB_NAME="${1:-unknown}"
BUILD_NUMBER="${2:-0}"
STAGE_NAME="${3:-unknown}"
STATUS="${4:-UNKNOWN}"
DETAILS="${5:-}"

PGHOST="${JENKINS_DB_HOST:-127.0.0.1}"
PGPORT="${JENKINS_DB_PORT:-5432}"
PGDATABASE="${JENKINS_DB_NAME:-jenkins}"
PGUSER="${JENKINS_DB_USER:-jenkins}"
PGPASSWORD="${JENKINS_DB_PASSWORD:?JENKINS_DB_PASSWORD required}"

export PGPASSWORD

DETAILS_ESCAPED="${DETAILS//\'/\'\'}"

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO pipeline_runs (job_name, build_number, status, started_at, finished_at, log_excerpt)
VALUES (
  '${JOB_NAME}',
  ${BUILD_NUMBER},
  '${STATUS}',
  NOW(),
  NOW(),
  '[${STAGE_NAME}] ${DETAILS_ESCAPED}'
)
ON CONFLICT (job_name, build_number) DO UPDATE
SET status = EXCLUDED.status,
    finished_at = NOW(),
    log_excerpt = pipeline_runs.log_excerpt || E'\n' || EXCLUDED.log_excerpt;
SQL
