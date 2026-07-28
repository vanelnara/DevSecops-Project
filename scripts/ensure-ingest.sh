#!/usr/bin/env bash
# Ensure the ingest bridge is running on the Jenkins agent and can reach Postgres.
# Always prefers a tracked host Node process (never a leftover Docker ingest on :4200).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INGEST_PORT="${INGEST_PORT:-4200}"
HEALTH_URL="http://127.0.0.1:${INGEST_PORT}/health"
RUNTIME_DIR="${SECURITY_RUNTIME_DIR:-${HOME}/.devsecops-services}"
LOG_DIR="${RUNTIME_DIR}/logs"
PID_DIR="${RUNTIME_DIR}/pids"
PID_FILE="${PID_DIR}/ingest-bridge.pid"
LOG_FILE="${LOG_DIR}/ingest-bridge.log"
DIR="${ROOT}/services/ingest-bridge"
FORCE_RESTART="${FORCE_INGEST_RESTART:-0}"

JENKINS_DB_HOST="${JENKINS_DB_HOST:-127.0.0.1}"
JENKINS_DB_PORT="${JENKINS_DB_PORT:-5432}"
JENKINS_DB_NAME="${JENKINS_DB_NAME:-jenkins}"
JENKINS_DB_USER="${JENKINS_DB_USER:-jenkins}"
: "${JENKINS_DB_PASSWORD:?JENKINS_DB_PASSWORD is required}"

if [ "${JENKINS_DB_HOST}" = "host.docker.internal" ] || [ "${JENKINS_DB_HOST}" = "172.17.0.1" ]; then
  JENKINS_DB_HOST="127.0.0.1"
fi

mkdir -p "${LOG_DIR}" "${PID_DIR}"

# Docker ingest often looks "healthy" while writing to a different Postgres than AI uses.
if command -v docker >/dev/null 2>&1; then
  docker rm -f devsecops-ingest >/dev/null 2>&1 || true
fi

healthy_db() {
  local body
  body="$(curl --silent --show-error --max-time 3 "${HEALTH_URL}" 2>/dev/null || true)"
  echo "${body}" | grep -q '"database":true' || return 1
  # Prefer host process we manage; reject anonymous listeners (e.g. foreign containers).
  if [ -f "${PID_FILE}" ]; then
    local pid
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

if [ "${FORCE_RESTART}" != "1" ] && healthy_db; then
  echo "ingest already healthy at ${HEALTH_URL} (host pid $(cat "${PID_FILE}"))"
  curl --silent --show-error --max-time 3 "${HEALTH_URL}" || true
  echo
  exit 0
fi

echo "Starting host ingest-bridge on :${INGEST_PORT} (DB ${JENKINS_DB_HOST}:${JENKINS_DB_PORT})"

if [ -f "${PID_FILE}" ]; then
  old_pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [ -n "${old_pid}" ]; then
    kill "${old_pid}" 2>/dev/null || true
    sleep 1
    kill -9 "${old_pid}" 2>/dev/null || true
  fi
  rm -f "${PID_FILE}"
fi
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${INGEST_PORT}/tcp" >/dev/null 2>&1 || true
elif command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -t -iTCP:"${INGEST_PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "${pids}" ]; then
    # shellcheck disable=SC2086
    kill ${pids} 2>/dev/null || true
  fi
fi
sleep 1

cd "${DIR}"
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund || npm install --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

export JENKINS_DB_HOST JENKINS_DB_PORT JENKINS_DB_NAME JENKINS_DB_USER JENKINS_DB_PASSWORD
export INGEST_PORT
export AI_ANALYZER_URL="${AI_ANALYZER_URL:-http://127.0.0.1:${AI_PORT:-4300}}"
export INGEST_TOKEN="${INGEST_TOKEN:-}"

nohup node src/index.js >>"${LOG_FILE}" 2>&1 &
echo $! >"${PID_FILE}"
echo "ingest pid $(cat "${PID_FILE}") — logs: ${LOG_FILE}"

for i in $(seq 1 45); do
  if healthy_db; then
    echo "ingest is healthy:"
    curl --silent --show-error --max-time 3 "${HEALTH_URL}"
    echo
    exit 0
  fi
  sleep 1
done

echo "ERROR: ingest failed to become healthy with database:true"
echo "---- last 60 log lines ----"
tail -n 60 "${LOG_FILE}" 2>/dev/null || true
exit 1
