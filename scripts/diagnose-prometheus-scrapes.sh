#!/usr/bin/env bash
# Diagnose optional Prometheus scrapes on the Jenkins Docker host.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

code() {
  curl -sS --max-time 5 -o /dev/null -w "%{http_code}" "$1" 2>/dev/null || echo "000"
}

echo "=== Core stack (expected UP) ==="
curl -sS --max-time 5 http://127.0.0.1:9090/api/v1/targets 2>/dev/null \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
for t in d.get('data', {}).get('activeTargets', []):
    job = t.get('labels', {}).get('job', '?')
    health = t.get('health', '?')
    err = (t.get('lastError') or '').strip()
    print(f\"  {job:28} {health:5} {err}\")
" 2>/dev/null || echo "  (Prometheus not reachable on :9090)"

echo
echo "=== Optional endpoints on THIS host ==="
J="$(code http://127.0.0.1:8080/prometheus)"
N="$(code http://127.0.0.1:31000/metrics)"
K="$(code http://127.0.0.1:31080/metrics)"
echo "  Jenkins /prometheus          HTTP ${J}  (need 200 before enabling scrape)"
echo "  node-exporter :31000         HTTP ${N}  (need 200)"
echo "  kube-state-metrics :31080    HTTP ${K}  (need 200)"
echo

if [[ "${J}" != "200" ]]; then
  cat <<'EOF'
--- Fix Jenkins 403 / non-200 ---
1. Manage Jenkins → Plugins → install "Prometheus metrics" (then restart if asked)
2. Manage Jenkins → Security → Authorization:
   - Lab: "Anyone can do anything", OR
   - Grant Anonymous: Overall/Read
3. Retest:
   curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/prometheus

EOF
fi

if [[ "${N}" != "200" || "${K}" != "200" ]]; then
  cat <<'EOF'
--- Fix K8s connection refused on :31000 / :31080 ---
Exporters are not running (or NodePorts are on another machine).

  kubectl apply -k k8s/monitoring/
  kubectl -n monitoring get pods,svc -o wide

  curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:31000/metrics
  curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:31080/metrics

If the cluster is NOT on this Jenkins host, change scrape targets from
host.docker.internal to the Kubernetes node IP in
monitoring/prometheus/scrape-optional.yml.example, then merge into prometheus.yml.

EOF
fi

cat <<'EOF'
--- Clean targets (recommended until optional is healthy) ---
Repo default prometheus.yml scrapes ONLY: pushgateway, cadvisor, prometheus.
If your lab still lists jenkins/k8s jobs, sync core config and refresh:

  git pull
  # ensure monitoring/prometheus/prometheus.yml has NO jenkins/k8s jobs
  scripts/refresh-monitoring.sh

Grafana pipeline panels use Pushgateway — they work with only the 3 core targets UP.

After Jenkins and K8s return HTTP 200, merge jobs from
monitoring/prometheus/scrape-optional.yml.example into prometheus.yml
and run scripts/refresh-monitoring.sh again.
EOF
