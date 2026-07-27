#!/usr/bin/env bash
# Publish Jenkins scanner reports + build metadata to the security ingest bridge.
set -euo pipefail

export INGEST_URL="${INGEST_URL:-http://127.0.0.1:4200/ingest/build}"
export INGEST_TOKEN="${INGEST_TOKEN:-}"
export JOB_NAME="${JOB_NAME:-${1:-Devops-project}}"
export BUILD_NUMBER="${BUILD_NUMBER:-${2:-0}}"
export STATUS="${STATUS:-${3:-SUCCESS}}"
export BRANCH="${BRANCH:-${GIT_BRANCH:-main}}"
export COMMIT_SHA="${COMMIT_SHA:-${GIT_COMMIT:-}}"
export TRIGGERED_BY="${TRIGGERED_BY:-jenkins}"
export IMAGE_TAG="${IMAGE_TAG:-}"
export REPORTS_DIR="${REPORTS_DIR:-reports}"
export DURATION_SECONDS="${DURATION_SECONDS:-}"
export STARTED_AT="${STARTED_AT:-}"
export FINISHED_AT="${FINISHED_AT:-}"
export STAGES_JSON="${STAGES_JSON:-[]}"

if [ "${BUILD_NUMBER}" = "0" ] || [ -z "${BUILD_NUMBER}" ]; then
  echo "BUILD_NUMBER is required"
  exit 1
fi

META_FILE="$(mktemp)"
trap 'rm -f "${META_FILE}"' EXIT

python3 - <<'PY' > "${META_FILE}"
import json, os
duration = os.environ.get("DURATION_SECONDS") or None
meta = {
  "jobName": os.environ.get("JOB_NAME", "Devops-project"),
  "buildNumber": int(os.environ.get("BUILD_NUMBER", "0")),
  "status": os.environ.get("STATUS", "SUCCESS"),
  "branch": (os.environ.get("BRANCH") or "main").replace("origin/", ""),
  "commitSha": os.environ.get("COMMIT_SHA") or None,
  "triggeredBy": os.environ.get("TRIGGERED_BY") or "jenkins",
  "imageTag": os.environ.get("IMAGE_TAG") or None,
  "startedAt": os.environ.get("STARTED_AT") or None,
  "finishedAt": os.environ.get("FINISHED_AT") or None,
  "durationSeconds": int(duration) if duration else None,
  "stages": json.loads(os.environ.get("STAGES_JSON") or "[]"),
}
print(json.dumps(meta))
PY

CURL_ARGS=(
  -sS
  -X POST
  "${INGEST_URL}"
  -F "meta=<${META_FILE};type=application/json"
)

if [ -n "${INGEST_TOKEN}" ]; then
  CURL_ARGS+=(-H "Authorization: Bearer ${INGEST_TOKEN}")
fi

if [ -f "${REPORTS_DIR}/gitleaks/report.json" ]; then
  CURL_ARGS+=(-F "gitleaks=@${REPORTS_DIR}/gitleaks/report.json;type=application/json")
fi
if [ -f "${REPORTS_DIR}/trivy/report.json" ]; then
  CURL_ARGS+=(-F "trivy=@${REPORTS_DIR}/trivy/report.json;type=application/json")
fi

OWASP_JSON="$(find "${REPORTS_DIR}/dependency-check" -name '*.json' 2>/dev/null | head -n 1 || true)"
if [ -n "${OWASP_JSON}" ] && [ -f "${OWASP_JSON}" ]; then
  CURL_ARGS+=(-F "dependencyCheck=@${OWASP_JSON};type=application/json")
fi

echo "Publishing build ${JOB_NAME} #${BUILD_NUMBER} to ${INGEST_URL}"

# Fail fast with a clear error if ingest cannot reach PostgreSQL.
HEALTH_URL="$(echo "${INGEST_URL}" | sed -E 's#/ingest/build/?$##')/health"
INGEST_HEALTH="$(curl --silent --show-error --max-time 5 "${HEALTH_URL}" || true)"
echo "Preflight ${HEALTH_URL} => ${INGEST_HEALTH}"
if ! echo "${INGEST_HEALTH}" | grep -q '"database":true'; then
  echo "ERROR: ingest bridge is up but PostgreSQL is unreachable from that service."
  echo "On the Jenkins host run: curl -s ${HEALTH_URL}"
  echo "Expected database:true. If you see 172.17.0.1, recreate services with scripts/ensure-security-services.sh"
  exit 1
fi

RESPONSE="$(curl "${CURL_ARGS[@]}")"
echo "${RESPONSE}"
echo "${RESPONSE}" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'
