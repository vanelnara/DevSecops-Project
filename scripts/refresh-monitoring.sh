#!/usr/bin/env bash
# Recreate Grafana/Prometheus/Pushgateway and clear legacy metrics.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

ENV_FILE="${ROOT}/monitoring/.env"
COMPOSE_FILE="${ROOT}/monitoring/docker-compose.yml"

if [ ! -f "${ENV_FILE}" ]; then
  cp "${ROOT}/monitoring/.env.example" "${ENV_FILE}"
  echo "Created ${ENV_FILE} from example"
fi

echo "Clearing legacy Pushgateway groups (if any)..."
curl -sS -X DELETE http://127.0.0.1:9091/metrics/job/jenkins_pipeline >/dev/null 2>&1 || true
curl -sS -X DELETE http://127.0.0.1:9091/metrics/job/devsecops_jenkins >/dev/null 2>&1 || true

echo "Recreating monitoring stack..."
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d --force-recreate

echo "Waiting for Grafana..."
for i in $(seq 1 40); do
  if curl -sS --max-time 3 http://127.0.0.1:3030/api/health >/dev/null 2>&1; then
    echo
    echo "Core targets (expect UP): pushgateway, cadvisor, prometheus"
    curl -sS http://127.0.0.1:9090/api/v1/targets 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); 
[print(t['labels'].get('job'), t['health'], t.get('lastError','')) for t in d.get('data',{}).get('activeTargets',[])]" \
      2>/dev/null || true
    echo
    echo "Grafana OK → http://127.0.0.1:3030  (admin / see monitoring/.env)"
    echo "Prometheus → http://127.0.0.1:9090/targets"
    echo "Pipeline panels use Pushgateway metrics (not Jenkins /prometheus)."
    echo "Optional Jenkins/K8s scrapes: see docs/GRAFANA_SETUP.md § Optional scrapes"
    exit 0
  fi
  sleep 2
done

echo "ERROR: Grafana did not become healthy"
docker compose -f "${COMPOSE_FILE}" ps || true
exit 1
