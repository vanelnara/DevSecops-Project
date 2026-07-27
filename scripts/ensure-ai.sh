#!/usr/bin/env bash
# Ensure the AI analyzer is running on the Jenkins agent and can reach Postgres.
# Prefers a host Node process on 127.0.0.1 (same pattern as ensure-ingest.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AI_PORT="${AI_PORT:-4300}"
HEALTH_URL="http://127.0.0.1:${AI_PORT}/health"
RUNTIME_DIR="${SECURITY_RUNTIME_DIR:-${HOME}/.devsecops-services}"
LOG_DIR="${RUNTIME_DIR}/logs"
PID_DIR="${RUNTIME_DIR}/pids"
PID_FILE="${PID_DIR}/ai-analyzer.pid"
LOG_FILE="${LOG_DIR}/ai-analyzer.log"
DIR="${ROOT}/services/ai-analyzer"

JENKINS_DB_HOST="${JENKINS_DB_HOST:-127.0.0.1}"
JENKINS_DB_PORT="${JENKINS_DB_PORT:-5432}"
JENKINS_DB_NAME="${JENKINS_DB_NAME:-jenkins}"
JENKINS_DB_USER="${JENKINS_DB_USER:-jenkins}"
: "${JENKINS_DB_PASSWORD:?JENKINS_DB_PASSWORD is required}"

if [ "${JENKINS_DB_HOST}" = "host.docker.internal" ] || [ "${JENKINS_DB_HOST}" = "172.17.0.1" ]; then
  JENKINS_DB_HOST="127.0.0.1"
fi

mkdir -p "${LOG_DIR}" "${PID_DIR}"

healthy() {
  local body
  body="$(curl --silent --show-error --max-time 3 "${HEALTH_URL}" 2>/dev/null || true)"
  echo "${body}" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

if healthy; then
  echo "AI analyzer already healthy at ${HEALTH_URL}"
  curl --silent --show-error --max-time 3 "${HEALTH_URL}" || true
  echo
  exit 0
fi

echo "Starting host ai-analyzer on :${AI_PORT} (DB ${JENKINS_DB_HOST}:${JENKINS_DB_PORT})"

if command -v docker >/dev/null 2>&1; then
  docker rm -f devsecops-ai >/dev/null 2>&1 || true
fi
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
  fuser -k "${AI_PORT}/tcp" >/dev/null 2>&1 || true
elif command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -t -iTCP:"${AI_PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "${pids}" ]; then
    # shellcheck disable=SC2086
    kill ${pids} 2>/dev/null || true
  fi
fi

cd "${DIR}"
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund || npm install --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

export JENKINS_DB_HOST JENKINS_DB_PORT JENKINS_DB_NAME JENKINS_DB_USER JENKINS_DB_PASSWORD
export AI_PORT
export AI_PROVIDER="${AI_PROVIDER:-huggingface}"
export HUGGINGFACE_API_KEY="${HUGGINGFACE_API_KEY:-}"
export HUGGINGFACE_MODEL="${HUGGINGFACE_MODEL:-Qwen/Qwen2.5-7B-Instruct:fastest}"
export HUGGINGFACE_API_URL="${HUGGINGFACE_API_URL:-}"

nohup node src/index.js >>"${LOG_FILE}" 2>&1 &
echo $! >"${PID_FILE}"
echo "ai-analyzer pid $(cat "${PID_FILE}") — logs: ${LOG_FILE}"

for i in $(seq 1 30); do
  if healthy; then
    echo "AI analyzer is healthy:"
    curl --silent --show-error --max-time 3 "${HEALTH_URL}"
    echo
    exit 0
  fi
  sleep 1
done

echo "ERROR: ai-analyzer failed to become healthy on ${HEALTH_URL}"
echo "---- last 60 log lines ----"
tail -n 60 "${LOG_FILE}" 2>/dev/null || true
exit 1
