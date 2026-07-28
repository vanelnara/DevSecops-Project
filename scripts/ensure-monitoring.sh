#!/usr/bin/env bash
# Ensure Prometheus + Grafana + Pushgateway + cAdvisor are running on this host.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

# Windows checkouts can leave CRLF and break #!/usr/bin/env bash on Linux agents.
sed -i 's/\r$//' "${ROOT}/scripts/"*.sh 2>/dev/null || true
chmod +x "${ROOT}/scripts/"*.sh 2>/dev/null || true

COMPOSE_FILE="${ROOT}/monitoring/docker-compose.yml"
ENV_FILE="${ROOT}/monitoring/.env"
GRAFANA_URL="${GRAFANA_URL:-http://127.0.0.1:3030}"
PUSHGATEWAY_URL="${PUSHGATEWAY_URL:-http://127.0.0.1:9091}"

# Pipeline metrics only need Pushgateway (+ Grafana). Core prometheus.yml scrapes
# pushgateway/cadvisor/prometheus — optional Jenkins/K8s jobs stay in scrape-optional.yml.example.

if [ ! -f "${ENV_FILE}" ]; then
  if [ -f "${ROOT}/monitoring/.env.example" ]; then
    cp "${ROOT}/monitoring/.env.example" "${ENV_FILE}"
    echo "Created ${ENV_FILE} from example — edit GF_SMTP_PASSWORD before relying on email alerts."
  else
    echo "ERROR: missing ${ENV_FILE}"
    exit 1
  fi
fi

healthy() {
  curl -sS --max-time 3 "$1" >/dev/null 2>&1
}

if healthy "${GRAFANA_URL}/api/health" && healthy "${PUSHGATEWAY_URL}/-/healthy"; then
  echo "Monitoring stack already healthy (Grafana + Pushgateway)"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to start the monitoring stack"
  exit 1
fi

echo "Starting monitoring stack..."
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d

for i in $(seq 1 40); do
  if healthy "${GRAFANA_URL}/api/health" && healthy "${PUSHGATEWAY_URL}/-/healthy"; then
    echo "Grafana:     ${GRAFANA_URL}  (admin / see monitoring/.env)"
    echo "Prometheus:  http://127.0.0.1:9090"
    echo "Pushgateway: ${PUSHGATEWAY_URL}"
    exit 0
  fi
  sleep 2
done

echo "ERROR: monitoring stack did not become healthy"
docker compose -f "${COMPOSE_FILE}" ps || true
exit 1
