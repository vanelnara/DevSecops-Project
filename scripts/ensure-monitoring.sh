#!/usr/bin/env bash
# Ensure Prometheus + Grafana + Pushgateway + cAdvisor are running and
# pipeline-safe. Called from the Jenkinsfile — no manual refresh required.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

# Windows checkouts can leave CRLF and break #!/usr/bin/env bash on Linux agents.
sed -i 's/\r$//' "${ROOT}/scripts/"*.sh 2>/dev/null || true
chmod +x "${ROOT}/scripts/"*.sh 2>/dev/null || true

COMPOSE_FILE="${ROOT}/monitoring/docker-compose.yml"
ENV_FILE="${ROOT}/monitoring/.env"
PROM_YML="${ROOT}/monitoring/prometheus/prometheus.yml"
GRAFANA_URL="${GRAFANA_URL:-http://127.0.0.1:3030}"
PUSHGATEWAY_URL="${PUSHGATEWAY_URL:-http://127.0.0.1:9091}"
PROMETHEUS_URL="${PROMETHEUS_URL:-http://127.0.0.1:9090}"

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "ERROR: missing ${COMPOSE_FILE}"
  exit 1
fi

if [ ! -f "${ENV_FILE}" ]; then
  if [ -f "${ROOT}/monitoring/.env.example" ]; then
    cp "${ROOT}/monitoring/.env.example" "${ENV_FILE}"
    echo "Created ${ENV_FILE} from example — set GF_SMTP_PASSWORD for email alerts."
  else
    echo "ERROR: missing ${ENV_FILE}"
    exit 1
  fi
fi

# Always install the core-only scrape config so Targets stay green.
# Optional Jenkins/K8s scrapes live in scrape-optional.yml.example (manual).
mkdir -p "$(dirname "${PROM_YML}")"
cat >"${PROM_YML}" <<'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  scrape_timeout: 10s

# Pipeline-safe core targets only (managed by scripts/ensure-monitoring.sh).
# Optional Jenkins + Kubernetes scrapes: monitoring/prometheus/scrape-optional.yml.example

scrape_configs:
  - job_name: pushgateway
    honor_labels: true
    metrics_path: /metrics
    static_configs:
      - targets: ["pushgateway:9091"]
        labels:
          component: metrics-ingest

  - job_name: cadvisor
    metrics_path: /metrics
    static_configs:
      - targets: ["cadvisor:8080"]
        labels:
          component: containers

  - job_name: prometheus
    static_configs:
      - targets: ["localhost:9090"]
        labels:
          component: monitoring
EOF

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to start the monitoring stack"
  exit 1
fi

healthy() {
  curl -sS --max-time 3 "$1" >/dev/null 2>&1
}

echo "Starting / syncing monitoring stack from ${ROOT} ..."
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d

# Bind-mount config changes need a Prometheus reload or recreate.
if healthy "${PROMETHEUS_URL}/-/ready"; then
  curl -sS -X POST --max-time 5 "${PROMETHEUS_URL}/-/reload" >/dev/null 2>&1 \
    || docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d --force-recreate prometheus
else
  docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d --force-recreate prometheus
fi

echo "Waiting for Grafana + Pushgateway + Prometheus ..."
for i in $(seq 1 60); do
  if healthy "${GRAFANA_URL}/api/health" \
    && healthy "${PUSHGATEWAY_URL}/-/healthy" \
    && healthy "${PROMETHEUS_URL}/-/ready"; then
    echo "Grafana:     ${GRAFANA_URL}"
    echo "Prometheus:  ${PROMETHEUS_URL}"
    echo "Pushgateway: ${PUSHGATEWAY_URL}"

    # Best-effort: confirm core scrape jobs are present (do not fail pipeline).
    curl -sS --max-time 5 "${PROMETHEUS_URL}/api/v1/targets" 2>/dev/null \
      | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
jobs = {}
for t in d.get("data", {}).get("activeTargets", []):
    job = t.get("labels", {}).get("job", "?")
    jobs[job] = t.get("health", "?")
for name in ("pushgateway", "cadvisor", "prometheus"):
    print("  target %s: %s" % (name, jobs.get(name, "missing")))
' 2>/dev/null || true
    exit 0
  fi
  sleep 2
done

echo "ERROR: monitoring stack did not become healthy"
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" ps || true
exit 1
