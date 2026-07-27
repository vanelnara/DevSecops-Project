#!/usr/bin/env bash
# Ensure ingest-bridge, AI analyzer, and security-dashboard are running in background.
# Idempotent: skips start when health checks already pass.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${SECURITY_RUNTIME_DIR:-${HOME}/.devsecops-services}"
LOG_DIR="${RUNTIME_DIR}/logs"
PID_DIR="${RUNTIME_DIR}/pids"
mkdir -p "${LOG_DIR}" "${PID_DIR}"

INGEST_PORT="${INGEST_PORT:-4200}"
AI_PORT="${AI_PORT:-4300}"
DASHBOARD_PORT="${DASHBOARD_API_PORT:-4100}"

JENKINS_DB_HOST="${JENKINS_DB_HOST:-127.0.0.1}"
JENKINS_DB_PORT="${JENKINS_DB_PORT:-5432}"
JENKINS_DB_NAME="${JENKINS_DB_NAME:-jenkins}"
JENKINS_DB_USER="${JENKINS_DB_USER:-jenkins}"
: "${JENKINS_DB_PASSWORD:?JENKINS_DB_PASSWORD is required}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: required command not found: $1"
    exit 2
  }
}

require_cmd node
require_cmd npm
require_cmd curl

healthy() {
  local url="$1"
  curl --silent --show-error --fail --max-time 3 "${url}" >/dev/null 2>&1
}

wait_healthy() {
  local name="$1"
  local url="$2"
  local retries="${3:-30}"
  local i=1
  while [ "${i}" -le "${retries}" ]; do
    if healthy "${url}"; then
      echo "${name} is healthy at ${url}"
      return 0
    fi
    sleep 2
    i=$((i + 1))
  done
  echo "ERROR: ${name} did not become healthy at ${url}"
  echo "---- last 40 log lines ----"
  tail -n 40 "${LOG_DIR}/${name}.log" 2>/dev/null || true
  return 1
}

stop_stale() {
  local name="$1"
  local pid_file="${PID_DIR}/${name}.pid"
  if [ -f "${pid_file}" ]; then
    local pid
    pid="$(cat "${pid_file}" 2>/dev/null || true)"
    if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
      echo "Stopping stale ${name} (pid ${pid})"
      kill "${pid}" 2>/dev/null || true
      sleep 1
      kill -9 "${pid}" 2>/dev/null || true
    fi
    rm -f "${pid_file}"
  fi
}

npm_prepare() {
  local dir="$1"
  echo "Installing dependencies in ${dir}"
  (
    cd "${dir}"
    # Prefer a clean lockfile install, but fall back when package.json and
    # package-lock.json drift (common after adding deps like pg).
    if [ -f package-lock.json ]; then
      if ! npm ci --no-audit --no-fund; then
        echo "WARN: npm ci failed in ${dir}; falling back to npm install"
        npm install --no-audit --no-fund
      fi
    else
      npm install --no-audit --no-fund
    fi
  )
}

start_bg() {
  local name="$1"
  local dir="$2"
  local cmd="$3"
  local health_url="$4"
  local log_file="${LOG_DIR}/${name}.log"
  local pid_file="${PID_DIR}/${name}.pid"

  if healthy "${health_url}"; then
    echo "${name} already running (${health_url})"
    return 0
  fi

  stop_stale "${name}"
  npm_prepare "${dir}"

  echo "Starting ${name} in background..."
  (
    cd "${dir}"
    export JENKINS_DB_HOST JENKINS_DB_PORT JENKINS_DB_NAME JENKINS_DB_USER JENKINS_DB_PASSWORD
    export INGEST_PORT AI_PORT DASHBOARD_API_PORT
    export AI_ANALYZER_URL="${AI_ANALYZER_URL:-http://127.0.0.1:${AI_PORT}}"
    export INGEST_URL="${INGEST_URL:-http://127.0.0.1:${INGEST_PORT}/ingest/build}"
    export AI_PROVIDER="${AI_PROVIDER:-huggingface}"
    export HUGGINGFACE_API_KEY="${HUGGINGFACE_API_KEY:-}"
    export HUGGINGFACE_MODEL="${HUGGINGFACE_MODEL:-Qwen/Qwen2.5-7B-Instruct:fastest}"
    export HUGGINGFACE_API_URL="${HUGGINGFACE_API_URL:-https://router.huggingface.co/v1/chat/completions}"
    export DASHBOARD_MOCK_FALLBACK="${DASHBOARD_MOCK_FALLBACK:-true}"
    # nohup so process survives after Jenkins step ends
    nohup bash -lc "${cmd}" >>"${log_file}" 2>&1 &
    echo $! >"${pid_file}"
  )

  wait_healthy "${name}" "${health_url}"
}

echo "=== Ensuring security services ==="
echo "Project root: ${ROOT}"
echo "Runtime dir:  ${RUNTIME_DIR}"

# 1) Ingest bridge
start_bg \
  "ingest-bridge" \
  "${ROOT}/services/ingest-bridge" \
  "node src/index.js" \
  "http://127.0.0.1:${INGEST_PORT}/health"

# 2) AI analyzer
start_bg \
  "ai-analyzer" \
  "${ROOT}/services/ai-analyzer" \
  "node src/index.js" \
  "http://127.0.0.1:${AI_PORT}/health"

# 3) Security dashboard (API + built UI on :4100)
DASHBOARD_DIR="${ROOT}/security-dashboard"
if [ ! -f "${DASHBOARD_DIR}/dist/index.html" ]; then
  echo "Building security-dashboard UI (first time)..."
  npm_prepare "${DASHBOARD_DIR}"
  (cd "${DASHBOARD_DIR}" && npm run build)
fi

start_bg \
  "security-dashboard" \
  "${DASHBOARD_DIR}" \
  "node server/index.js" \
  "http://127.0.0.1:${DASHBOARD_PORT}/api/health"

echo "=== All security services are up ==="
echo "Ingest:    http://127.0.0.1:${INGEST_PORT}/health"
echo "AI:        http://127.0.0.1:${AI_PORT}/health"
echo "Dashboard: http://127.0.0.1:${DASHBOARD_PORT}/"
