#!/usr/bin/env bash
# Publish Jenkins scanner reports + build metadata to the security ingest bridge.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

export INGEST_URL="http://127.0.0.1:${INGEST_PORT:-4200}/ingest/build"
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
export JENKINS_DB_HOST="${JENKINS_DB_HOST:-127.0.0.1}"
export JENKINS_DB_PORT="${JENKINS_DB_PORT:-5432}"
export JENKINS_DB_NAME="${JENKINS_DB_NAME:-jenkins}"
export JENKINS_DB_USER="${JENKINS_DB_USER:-jenkins}"

if [ "${BUILD_NUMBER}" = "0" ] || [ -z "${BUILD_NUMBER}" ]; then
  echo "BUILD_NUMBER is required"
  exit 1
fi

: "${JENKINS_DB_PASSWORD:?JENKINS_DB_PASSWORD is required}"

chmod +x scripts/ensure-ingest.sh
scripts/ensure-ingest.sh

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
RESPONSE="$(curl "${CURL_ARGS[@]}")"
echo "${RESPONSE}"
echo "${RESPONSE}" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'
