#!/usr/bin/env bash
# Start security stack so ingest/AI/dashboard can reach the Jenkins PostgreSQL DB.
# Falls back to host Node processes only when Docker is unavailable.
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

export JENKINS_DB_PASSWORD
export JENKINS_DB_NAME JENKINS_DB_USER JENKINS_DB_PORT JENKINS_DB_HOST
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

primary_lan_ip() {
  hostname -I 2>/dev/null | awk '{print $1}'
}

start_with_docker() {
  echo "=== Starting security stack with Docker Compose ==="
  echo "Project: ${ROOT}"

  local compose_files=(-f docker-compose.yml)
  local profiles=()
  local compose_db_host="postgres"
  local mode="compose-net"

  if docker ps --format '{{.Names}}' | grep -qx 'devsecops-postgres'; then
    docker network create devsecops-net >/dev/null 2>&1 || true
    docker network connect --alias postgres devsecops-net devsecops-postgres >/dev/null 2>&1 || true
    compose_db_host="postgres"
    mode="compose-net"
    echo "Using existing container devsecops-postgres on network devsecops-net"
  elif db_reachable "127.0.0.1" "${JENKINS_DB_PORT}" || { [ "${JENKINS_DB_HOST}" != "127.0.0.1" ] && db_reachable; }; then
    # Host Postgres is up. On Linux use host networking so DB is 127.0.0.1
    # (bridge host.docker.internal -> 172.17.0.1 fails when Postgres listens on localhost only).
    if [ "$(uname -s)" = "Linux" ]; then
      compose_files=(-f docker-compose.host-db.yml)
      compose_db_host="127.0.0.1"
      mode="host-net"
      echo "Host PostgreSQL detected — using host networking (DB 127.0.0.1:${JENKINS_DB_PORT})"
    else
      compose_db_host="host.docker.internal"
      mode="compose-net"
      echo "Host PostgreSQL detected — using host.docker.internal"
    fi
  else
    echo "No PostgreSQL on ${JENKINS_DB_HOST}:${JENKINS_DB_PORT} — starting compose postgres (profile with-db)"
    profiles+=(--profile with-db)
    compose_db_host="postgres"
    mode="compose-net"
  fi

  export COMPOSE_DB_HOST="${compose_db_host}"

  # Stop any previous bridge-mode containers that may still bind the ports
  docker rm -f devsecops-ingest devsecops-ai devsecops-dashboard >/dev/null 2>&1 || true

  # Recreate so DB host / network mode changes always apply
  # shellcheck disable=SC2086
  compose_cmd "${compose_files[@]}" "${profiles[@]}" up -d --build --force-recreate \
    ingest-bridge ai-analyzer security-dashboard

  if [ "${#profiles[@]}" -gt 0 ]; then
    compose_cmd "${compose_files[@]}" --profile with-db up -d postgres
    local i=1
    while [ "${i}" -le 30 ]; do
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' devsecops-postgres 2>/dev/null || true)"
      if [ "${status}" = "healthy" ] || [ "${status}" = "running" ]; then
        echo "postgres container status: ${status}"
        break
      fi
      sleep 2
      i=$((i + 1))
    done
  fi

  chmod +x scripts/apply-db-migrations.sh
  JENKINS_DB_HOST=127.0.0.1 scripts/apply-db-migrations.sh || \
    JENKINS_DB_HOST="${JENKINS_DB_HOST}" scripts/apply-db-migrations.sh

  wait_url "ingest-bridge" "http://127.0.0.1:${INGEST_PORT}/health"
  wait_url "ai-analyzer" "http://127.0.0.1:${AI_PORT}/health"
  wait_url "security-dashboard" "http://127.0.0.1:${DASHBOARD_PORT}/api/health"

  # Prove ingest can talk to Postgres (the failure mode behind ECONNREFUSED 172.17.0.1:5432)
  echo "Verifying ingest DB connectivity..."
  ingest_health="$(curl --silent --show-error --max-time 5 "http://127.0.0.1:${INGEST_PORT}/health" || true)"
  echo "ingest /health => ${ingest_health}"
  if ! echo "${ingest_health}" | grep -q '"database":true'; then
    echo "ERROR: ingest-bridge cannot reach PostgreSQL. Check JENKINS_DB_* and docker logs for devsecops-ingest."
    docker logs --tail 50 devsecops-ingest || true
    exit 1
  fi

  echo "=== Security stack is up (mode=${mode}, COMPOSE_DB_HOST=${COMPOSE_DB_HOST}) ==="
  compose_cmd "${compose_files[@]}" ps || true
  echo "Dashboard: http://127.0.0.1:${DASHBOARD_PORT}/  (login admin/admin)"
  echo "Ingest:    http://127.0.0.1:${INGEST_PORT}/health"
  echo "AI:        http://127.0.0.1:${AI_PORT}/health"
  if [ "${mode}" = "host-net" ]; then
    echo "Troubleshoot: docker logs -f devsecops-ingest devsecops-ai devsecops-dashboard"
  else
    echo "Troubleshoot: docker compose logs -f security-dashboard ai-analyzer ingest-bridge"
  fi
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
      export JENKINS_DB_HOST JENKINS_DB_PORT JENKINS_DB_NAME JENKINS_DB_USER JENKINS_DB_PASSWORD
      export INGEST_PORT AI_PORT DASHBOARD_API_PORT
      export AI_ANALYZER_URL="${AI_ANALYZER_URL:-http://127.0.0.1:${AI_PORT}}"
      export HUGGINGFACE_API_KEY HUGGINGFACE_MODEL HUGGINGFACE_API_URL AI_PROVIDER
      export DASHBOARD_MOCK_FALLBACK
      nohup bash -lc "${cmd}" >>"${log_file}" 2>&1 &
      echo $! >"${pid_file}"
    )
    wait_url "${name}" "${health_url}"
  }

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
