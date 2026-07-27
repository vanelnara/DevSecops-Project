#!/usr/bin/env bash
# Start security stack so ingest can reach the Jenkins PostgreSQL on 127.0.0.1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

INGEST_PORT="${INGEST_PORT:-4200}"
AI_PORT="${AI_PORT:-4300}"
DASHBOARD_PORT="${DASHBOARD_API_PORT:-4100}"
JENKINS_DB_HOST="${JENKINS_DB_HOST:-127.0.0.1}"
JENKINS_DB_PORT="${JENKINS_DB_PORT:-5432}"
JENKINS_DB_NAME="${JENKINS_DB_NAME:-jenkins}"
JENKINS_DB_USER="${JENKINS_DB_USER:-jenkins}"
: "${JENKINS_DB_PASSWORD:?JENKINS_DB_PASSWORD is required}"

# Never inherit a bad bridge gateway host from Jenkins global env.
unset COMPOSE_DB_HOST || true
if [ "${JENKINS_DB_HOST}" = "host.docker.internal" ] || [ "${JENKINS_DB_HOST}" = "172.17.0.1" ]; then
  echo "WARN: JENKINS_DB_HOST=${JENKINS_DB_HOST} is not reachable for local Postgres; forcing 127.0.0.1"
  JENKINS_DB_HOST="127.0.0.1"
fi

export JENKINS_DB_PASSWORD JENKINS_DB_NAME JENKINS_DB_USER JENKINS_DB_PORT JENKINS_DB_HOST
export HUGGINGFACE_API_KEY="${HUGGINGFACE_API_KEY:-}"
export HUGGINGFACE_MODEL="${HUGGINGFACE_MODEL:-Qwen/Qwen2.5-7B-Instruct:fastest}"
export HUGGINGFACE_API_URL="${HUGGINGFACE_API_URL:-https://router.huggingface.co/v1/chat/completions}"
export AI_PROVIDER="${AI_PROVIDER:-huggingface}"
export INGEST_TOKEN="${INGEST_TOKEN:-}"
export DASHBOARD_MOCK_FALLBACK="${DASHBOARD_MOCK_FALLBACK:-false}"
export INGEST_PORT AI_PORT DASHBOARD_API_PORT="${DASHBOARD_PORT}"

healthy() {
  curl --silent --show-error --fail --max-time 3 "$1" >/dev/null 2>&1
}

wait_url() {
  local name="$1" url="$2" retries="${3:-40}" i=1
  while [ "${i}" -le "${retries}" ]; do
    if healthy "${url}"; then
      echo "${name} healthy: ${url}"
      return 0
    fi
    sleep 2
    i=$((i + 1))
  done
  echo "ERROR: ${name} did not become healthy (${url})"
  return 1
}

db_reachable() {
  local host="${1:-${JENKINS_DB_HOST}}"
  local port="${2:-${JENKINS_DB_PORT}}"
  if command -v pg_isready >/dev/null 2>&1; then
    PGPASSWORD="${JENKINS_DB_PASSWORD}" pg_isready -h "${host}" -p "${port}" -U "${JENKINS_DB_USER}" >/dev/null 2>&1
    return $?
  fi
  (echo >"/dev/tcp/${host}/${port}") >/dev/null 2>&1
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

free_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  fi
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -t -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "${pids}" ]; then
      # shellcheck disable=SC2086
      kill ${pids} 2>/dev/null || true
      sleep 1
      # shellcheck disable=SC2086
      kill -9 ${pids} 2>/dev/null || true
    fi
  fi
}

start_with_docker() {
  echo "=== Starting security stack with Docker ==="
  echo "Project: ${ROOT}"
  echo "Host DB target: ${JENKINS_DB_HOST}:${JENKINS_DB_PORT}"

  local compose_file="docker-compose.yml"
  local profiles=()
  local mode="compose-net"

  # Linux + local Postgres => host networking (fixes ECONNREFUSED 172.17.0.1:5432)
  if [ "$(uname -s)" = "Linux" ] && db_reachable "127.0.0.1" "${JENKINS_DB_PORT}"; then
    compose_file="docker-compose.host-db.yml"
    mode="host-net"
    export COMPOSE_DB_HOST="127.0.0.1"
    JENKINS_DB_HOST="127.0.0.1"
    export JENKINS_DB_HOST
    echo "Using host-network compose (${compose_file}) so containers reach Postgres on 127.0.0.1"
  elif docker ps --format '{{.Names}}' | grep -qx 'devsecops-postgres'; then
    docker network create devsecops-net >/dev/null 2>&1 || true
    docker network connect --alias postgres devsecops-net devsecops-postgres >/dev/null 2>&1 || true
    export COMPOSE_DB_HOST="postgres"
    mode="compose-net"
    echo "Using existing devsecops-postgres on devsecops-net"
  elif ! db_reachable; then
    echo "No PostgreSQL reachable — starting compose postgres (profile with-db)"
    profiles+=(--profile with-db)
    export COMPOSE_DB_HOST="postgres"
    mode="compose-net"
  else
    # Non-Linux Docker Desktop
    export COMPOSE_DB_HOST="host.docker.internal"
    mode="compose-net"
    echo "Using bridge compose with host.docker.internal"
  fi

  echo "Stopping any previous ingest/ai/dashboard containers and freeing ports..."
  docker rm -f devsecops-ingest devsecops-ai devsecops-dashboard >/dev/null 2>&1 || true
  # Also remove old compose project containers if present
  compose_cmd -f docker-compose.yml down --remove-orphans >/dev/null 2>&1 || true
  compose_cmd -f docker-compose.host-db.yml down --remove-orphans >/dev/null 2>&1 || true
  free_port "${INGEST_PORT}"
  free_port "${AI_PORT}"
  free_port "${DASHBOARD_PORT}"

  # shellcheck disable=SC2086
  compose_cmd -f "${compose_file}" "${profiles[@]}" up -d --build --force-recreate \
    ingest-bridge ai-analyzer security-dashboard

  if [ "${#profiles[@]}" -gt 0 ]; then
    compose_cmd -f "${compose_file}" --profile with-db up -d postgres
  fi

  chmod +x scripts/apply-db-migrations.sh
  JENKINS_DB_HOST=127.0.0.1 scripts/apply-db-migrations.sh || \
    JENKINS_DB_HOST="${JENKINS_DB_HOST}" scripts/apply-db-migrations.sh

  wait_url "ingest-bridge" "http://127.0.0.1:${INGEST_PORT}/health"
  wait_url "ai-analyzer" "http://127.0.0.1:${AI_PORT}/health"
  wait_url "security-dashboard" "http://127.0.0.1:${DASHBOARD_PORT}/api/health"

  echo "Container DB env (should be 127.0.0.1 on Linux host-net):"
  docker inspect -f '{{.Name}} JENKINS_DB_HOST={{range .Config.Env}}{{println .}}{{end}}' devsecops-ingest 2>/dev/null \
    | grep -E 'JENKINS_DB_HOST|Name=' || true

  ingest_health="$(curl --silent --show-error --max-time 5 "http://127.0.0.1:${INGEST_PORT}/health" || true)"
  echo "ingest /health => ${ingest_health}"
  if ! echo "${ingest_health}" | grep -q '"database":true'; then
    echo "ERROR: ingest-bridge cannot reach PostgreSQL."
    docker logs --tail 80 devsecops-ingest || true
    exit 1
  fi

  echo "=== Security stack is up (mode=${mode}) ==="
  echo "Dashboard: http://127.0.0.1:${DASHBOARD_PORT}/  (admin/admin)"
  echo "Ingest:    http://127.0.0.1:${INGEST_PORT}/health"
  echo "AI:        http://127.0.0.1:${AI_PORT}/health"
}

start_with_node_fallback() {
  echo "WARN: Docker not available — falling back to host Node processes"
  RUNTIME_DIR="${SECURITY_RUNTIME_DIR:-${HOME}/.devsecops-services}"
  LOG_DIR="${RUNTIME_DIR}/logs"
  PID_DIR="${RUNTIME_DIR}/pids"
  mkdir -p "${LOG_DIR}" "${PID_DIR}"

  chmod +x scripts/apply-db-migrations.sh
  scripts/apply-db-migrations.sh

  npm_prepare() {
    local dir="$1"
    (
      cd "${dir}"
      if [ -f package-lock.json ]; then
        npm ci --no-audit --no-fund || npm install --no-audit --no-fund
      else
        npm install --no-audit --no-fund
      fi
    )
  }

  start_bg() {
    local name="$1" dir="$2" cmd="$3" health_url="$4"
    local log_file="${LOG_DIR}/${name}.log" pid_file="${PID_DIR}/${name}.pid"
    if healthy "${health_url}"; then
      echo "${name} already running"
      return 0
    fi
    if [ -f "${pid_file}" ]; then
      kill "$(cat "${pid_file}")" 2>/dev/null || true
      rm -f "${pid_file}"
    fi
    npm_prepare "${dir}"
    (
      cd "${dir}"
      export JENKINS_DB_HOST=127.0.0.1
      export JENKINS_DB_PORT JENKINS_DB_NAME JENKINS_DB_USER JENKINS_DB_PASSWORD
      export INGEST_PORT AI_PORT DASHBOARD_API_PORT
      export AI_ANALYZER_URL="${AI_ANALYZER_URL:-http://127.0.0.1:${AI_PORT}}"
      export HUGGINGFACE_API_KEY HUGGINGFACE_MODEL HUGGINGFACE_API_URL AI_PROVIDER
      export DASHBOARD_MOCK_FALLBACK
      nohup bash -lc "${cmd}" >>"${log_file}" 2>&1 &
      echo $! >"${pid_file}"
    )
    wait_url "${name}" "${health_url}"
  }

  free_port "${INGEST_PORT}"
  free_port "${AI_PORT}"
  free_port "${DASHBOARD_PORT}"

  start_bg ingest-bridge "${ROOT}/services/ingest-bridge" "node src/index.js" "http://127.0.0.1:${INGEST_PORT}/health"
  start_bg ai-analyzer "${ROOT}/services/ai-analyzer" "node src/index.js" "http://127.0.0.1:${AI_PORT}/health"
  npm_prepare "${ROOT}/security-dashboard"
  (cd "${ROOT}/security-dashboard" && npm run build)
  start_bg security-dashboard "${ROOT}/security-dashboard" "node server/index.js" "http://127.0.0.1:${DASHBOARD_PORT}/api/health"
}

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  start_with_docker
else
  start_with_node_fallback
fi
