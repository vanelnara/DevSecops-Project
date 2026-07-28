#!/usr/bin/env bash
# Push Jenkins build metrics to Prometheus Pushgateway (scraped by Grafana).
# Uses a replaceable "latest" group so SUCCESS clears a previous FAILED correctly.
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

# Normalize numeric env (avoid empty → bad Prometheus values)
DURATION_SECONDS="$(echo "${DURATION_SECONDS}" | tr -cd '0-9.' | sed 's/^\.$/0/;s/^$/0/')"
FINDINGS_TOTAL="$(echo "${FINDINGS_TOTAL}" | tr -cd '0-9' | sed 's/^$/0/')"
RISK_SCORE="$(echo "${RISK_SCORE}" | tr -cd '0-9.' | sed 's/^\.$/0/;s/^$/0/')"

STATUS_UPPER="$(echo "${STATUS}" | tr '[:lower:]' '[:upper:]')"
# 0 = success, 1 = failed, 2 = unstable (AI/quality gate soft fail)
STATUS_CODE=0
case "${STATUS_UPPER}" in
  FAILURE|FAILED|ABORTED) STATUS_CODE=1 ;;
  UNSTABLE) STATUS_CODE=2 ;;
  SUCCESS|SUCCESSFUL|"") STATUS_CODE=0; STATUS_UPPER="SUCCESS" ;;
  *) STATUS_CODE=0 ;;
esac

FAILED=0
[ "${STATUS_CODE}" = "1" ] && FAILED=1
SUCCESS=0
[ "${STATUS_CODE}" = "0" ] && SUCCESS=1

NOW_EPOCH="$(date +%s)"
safe_job="$(echo "${JOB_NAME}" | tr -c 'A-Za-z0-9_-' '_')"

echo "Publishing metrics for ${JOB_NAME} #${BUILD_NUMBER} (${STATUS_UPPER}/${STATUS_CODE}) → ${PUSHGATEWAY_URL}"

# Drop previous "latest" snapshot so old FAILED gauges cannot stick around.
curl -sS -X DELETE \
  "${PUSHGATEWAY_URL}/metrics/job/devsecops_jenkins/instance/${safe_job}" \
  >/dev/null 2>&1 || true

TMP_LATEST="$(mktemp)"
TMP_HISTORY="$(mktemp)"
trap 'rm -f "${TMP_LATEST}" "${TMP_HISTORY}"' EXIT

cat >"${TMP_LATEST}" <<EOF
# TYPE devsecops_jenkins_build_number gauge
# HELP devsecops_jenkins_build_number Latest Jenkins build number for the job
devsecops_jenkins_build_number{job_name="${JOB_NAME}",result="${STATUS_UPPER}"} ${BUILD_NUMBER}
# TYPE devsecops_jenkins_build_status gauge
# HELP devsecops_jenkins_build_status 0=success 1=failed 2=unstable
devsecops_jenkins_build_status{job_name="${JOB_NAME}",result="${STATUS_UPPER}"} ${STATUS_CODE}
# TYPE devsecops_jenkins_build_failed gauge
# HELP devsecops_jenkins_build_failed 1 when the latest hard-failed build
devsecops_jenkins_build_failed{job_name="${JOB_NAME}",result="${STATUS_UPPER}"} ${FAILED}
# TYPE devsecops_jenkins_build_success gauge
devsecops_jenkins_build_success{job_name="${JOB_NAME}",result="${STATUS_UPPER}"} ${SUCCESS}
# TYPE devsecops_jenkins_build_duration_seconds gauge
devsecops_jenkins_build_duration_seconds{job_name="${JOB_NAME}",result="${STATUS_UPPER}"} ${DURATION_SECONDS}
# TYPE devsecops_jenkins_findings_total gauge
devsecops_jenkins_findings_total{job_name="${JOB_NAME}",result="${STATUS_UPPER}"} ${FINDINGS_TOTAL}
# TYPE devsecops_jenkins_risk_score gauge
devsecops_jenkins_risk_score{job_name="${JOB_NAME}",result="${STATUS_UPPER}"} ${RISK_SCORE}
# TYPE devsecops_jenkins_build_unixtime gauge
devsecops_jenkins_build_unixtime{job_name="${JOB_NAME}",result="${STATUS_UPPER}"} ${NOW_EPOCH}
EOF

if ! curl -sS -f --data-binary @"${TMP_LATEST}" \
  "${PUSHGATEWAY_URL}/metrics/job/devsecops_jenkins/instance/${safe_job}"; then
  echo "ERROR: Pushgateway publish failed at ${PUSHGATEWAY_URL}"
  echo "Start monitoring: docker compose -f monitoring/docker-compose.yml --env-file monitoring/.env up -d"
  exit 1
fi
echo "Pushgateway latest OK"

# Keep per-build history for trend panels (does not affect "latest status")
cat >"${TMP_HISTORY}" <<EOF
# TYPE devsecops_jenkins_history_status gauge
devsecops_jenkins_history_status{job_name="${JOB_NAME}",build="${BUILD_NUMBER}",result="${STATUS_UPPER}"} ${STATUS_CODE}
# TYPE devsecops_jenkins_history_duration_seconds gauge
devsecops_jenkins_history_duration_seconds{job_name="${JOB_NAME}",build="${BUILD_NUMBER}",result="${STATUS_UPPER}"} ${DURATION_SECONDS}
# TYPE devsecops_jenkins_history_findings_total gauge
devsecops_jenkins_history_findings_total{job_name="${JOB_NAME}",build="${BUILD_NUMBER}",result="${STATUS_UPPER}"} ${FINDINGS_TOTAL}
# TYPE devsecops_jenkins_history_risk_score gauge
devsecops_jenkins_history_risk_score{job_name="${JOB_NAME}",build="${BUILD_NUMBER}",result="${STATUS_UPPER}"} ${RISK_SCORE}
EOF

curl -sS -f --data-binary @"${TMP_HISTORY}" \
  "${PUSHGATEWAY_URL}/metrics/job/devsecops_jenkins_history/instance/${safe_job}/build/${BUILD_NUMBER}" \
  >/dev/null && echo "Pushgateway history OK" || echo "WARN: history push skipped"

if curl -sS --max-time 3 "${GRAFANA_URL}/api/health" >/dev/null 2>&1; then
  TEXT="Jenkins ${JOB_NAME} #${BUILD_NUMBER} → ${STATUS_UPPER}"
  TAG="success"
  [ "${STATUS_CODE}" = "1" ] && TAG="failure"
  [ "${STATUS_CODE}" = "2" ] && TAG="unstable"
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
