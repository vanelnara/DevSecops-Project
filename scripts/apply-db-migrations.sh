#!/usr/bin/env bash
# Apply dashboard SQL migrations to the shared Jenkins PostgreSQL database.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGHOST="${JENKINS_DB_HOST:-127.0.0.1}"
PGPORT="${JENKINS_DB_PORT:-5432}"
PGDATABASE="${JENKINS_DB_NAME:-jenkins}"
PGUSER="${JENKINS_DB_USER:-jenkins}"
: "${JENKINS_DB_PASSWORD:?JENKINS_DB_PASSWORD is required}"
export PGPASSWORD="${JENKINS_DB_PASSWORD}"
export JENKINS_DB_HOST PGHOST
export JENKINS_DB_PORT="${PGPORT}"
export JENKINS_DB_NAME="${PGDATABASE}"
export JENKINS_DB_USER="${PGUSER}"

echo "Applying dashboard migrations to ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"

apply_with_node() {
  local file="$1"
  (
    cd "${ROOT}/security-dashboard"
    if [ ! -d node_modules/pg ]; then
      npm install pg --no-audit --no-fund
    fi
    MIGRATION_FILE="${file}" node --input-type=module <<'NODE'
import fs from 'node:fs';
import pg from 'pg';

const sql = fs.readFileSync(process.env.MIGRATION_FILE, 'utf8');
const client = new pg.Client({
  host: process.env.JENKINS_DB_HOST || '127.0.0.1',
  port: Number(process.env.JENKINS_DB_PORT || 5432),
  database: process.env.JENKINS_DB_NAME || 'jenkins',
  user: process.env.JENKINS_DB_USER || 'jenkins',
  password: String(process.env.JENKINS_DB_PASSWORD || ''),
});
await client.connect();
try {
  await client.query(sql);
  console.log(`Applied ${process.env.MIGRATION_FILE}`);
} finally {
  await client.end();
}
NODE
  )
}

for migration in \
  "${ROOT}/db/migrations/001_security_dashboard.sql" \
  "${ROOT}/db/migrations/002_dashboard_users.sql"
do
  if [ ! -f "${migration}" ]; then
    echo "WARN: migration missing: ${migration}"
    continue
  fi
  echo " -> $(basename "${migration}")"
  if command -v psql >/dev/null 2>&1; then
    psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 -f "${migration}"
  else
    apply_with_node "${migration}"
  fi
done

echo "Migrations complete."
