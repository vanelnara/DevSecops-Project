#!/usr/bin/env bash
# Push Jenkins build / security metrics to Prometheus Pushgateway (scraped by Grafana).
# Optionally annotate Grafana with the build result.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

JOB_NAME="${JOB_NAME:-${1:-Devops-project}}"
BUILD_NUMBER="${BUILD_NUMBER:-${2:-0}}"
STATUS="${STATUS:-${3:-UNKNOWN}}"
DURATION_SECONDS="${DURATION_SECONDS:-0}"
FINDINGS_TOTAL="${FINDINGS_TOTAL:-0}"
RISK_SCORE="${RISK_SCORE:-0}"

PUSHGATEWAY_URL="${PUSHGATEWAY_URL:-http://127.0.0.1:9091}"
GRAFANA_URL="${GRAFANA_URL:-http://127.0.0.1:3030}"
GRAFANA_USER="${GRAFANA_USER:-admin}"
GRAFANA_PASSWORD="${GRAFANA_PASSWORD:-admin}"

if [ "${BUILD_NUMBER}" = "0" ] || [ -z "${BUILD_NUMBER}" ]; then
  echo "BUILD_NUMBER is required"
  exit 1
fi

STATUS_UPPER="$(echo "${STATUS}" | tr '[:lower:]' '[:upper:]')"
FAILED=0
case "${STATUS_UPPER}" in
  FAILURE|FAILED|UNSTABLE|ABORTED) FAILED=1 ;;
esac

NOW_EPOCH="$(date +%s)"
SUCCESS_TS=0
if [ "${FAILED}" = "0" ]; then
  SUCCESS_TS="${NOW_EPOCH}"
fi

safe_job="$(echo "${JOB_NAME}" | tr -c 'A-Za-z0-9_-' '_')"

echo "Publishing metrics for ${JOB_NAME} #${BUILD_NUMBER} (${STATUS_UPPER}) → ${PUSHGATEWAY_URL}"

TMP_METRICS="$(mktemp)"
trap 'rm -f "${TMP_METRICS}"' EXIT

cat >"${TMP_METRICS}" <<EOF
# TYPE jenkins_pipeline_build_number gauge
jenkins_pipeline_build_number{job_name="${JOB_NAME}",status="${STATUS_UPPER}"} ${BUILD_NUMBER}
# TYPE jenkins_pipeline_failed gauge
jenkins_pipeline_failed{job_name="${JOB_NAME}",status="${STATUS_UPPER}"} ${FAILED}
# TYPE jenkins_pipeline_duration_seconds gauge
jenkins_pipeline_duration_seconds{job_name="${JOB_NAME}",status="${STATUS_UPPER}"} ${DURATION_SECONDS}
# TYPE jenkins_pipeline_findings_total gauge
jenkins_pipeline_findings_total{job_name="${JOB_NAME}",status="${STATUS_UPPER}"} ${FINDINGS_TOTAL}
# TYPE jenkins_pipeline_risk_score gauge
jenkins_pipeline_risk_score{job_name="${JOB_NAME}",status="${STATUS_UPPER}"} ${RISK_SCORE}
# TYPE jenkins_pipeline_last_success_unixtime gauge
jenkins_pipeline_last_success_unixtime{job_name="${JOB_NAME}"} ${SUCCESS_TS}
EOF

if ! curl -sS -f --data-binary @"${TMP_METRICS}" \
  "${PUSHGATEWAY_URL}/metrics/job/jenkins_pipeline/instance/${safe_job}/build_number/${BUILD_NUMBER}"; then
  echo "ERROR: Pushgateway publish failed at ${PUSHGATEWAY_URL}"
  echo "Start monitoring: docker compose -f monitoring/docker-compose.yml --env-file monitoring/.env up -d"
  exit 1
fi
echo
echo "Pushgateway OK"

if curl -sS --max-time 3 "${GRAFANA_URL}/api/health" >/dev/null 2>&1; then
  TEXT="Jenkins ${JOB_NAME} #${BUILD_NUMBER} → ${STATUS_UPPER}"
  TAG="success"
  [ "${FAILED}" = "1" ] && TAG="failure"
  TIME_MS=$((NOW_EPOCH * 1000))
  curl -sS --max-time 5 -u "${GRAFANA_USER}:${GRAFANA_PASSWORD}" \
    -H 'Content-Type: application/json' \
    -d "{\"dashboardUID\":\"devsecops-overview\",\"time\":${TIME_MS},\"tags\":[\"jenkins\",\"build\",\"${TAG}\"],\"text\":\"${TEXT}\"}" \
    "${GRAFANA_URL}/api/annotations" >/dev/null \
    && echo "Grafana annotation OK" \
    || echo "WARN: Grafana annotation skipped"
else
  echo "WARN: Grafana not reachable at ${GRAFANA_URL} — metrics still in Pushgateway"
fi

echo "Metrics publish complete"
