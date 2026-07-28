#!/usr/bin/env bash
# Trigger Hugging Face AI analysis for a stored build (called from Jenkins).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

export AI_PORT="${AI_PORT:-4300}"
export AI_ANALYZER_URL="http://127.0.0.1:${AI_PORT}"
export AI_TIMEOUT_MS="${AI_TIMEOUT_MS:-60000}"
export INGEST_PORT="${INGEST_PORT:-4200}"
export JENKINS_DB_HOST="${JENKINS_DB_HOST:-127.0.0.1}"
export JENKINS_DB_PORT="${JENKINS_DB_PORT:-5432}"
export JENKINS_DB_NAME="${JENKINS_DB_NAME:-jenkins}"
export JENKINS_DB_USER="${JENKINS_DB_USER:-jenkins}"

JOB_NAME="${JOB_NAME:-${1:-Devops-project}}"
BUILD_NUMBER="${BUILD_NUMBER:-${2:-0}}"

if [ "${BUILD_NUMBER}" = "0" ] || [ -z "${BUILD_NUMBER}" ]; then
  echo "BUILD_NUMBER is required"
  exit 1
fi

: "${JENKINS_DB_PASSWORD:?JENKINS_DB_PASSWORD is required}"

chmod +x scripts/ensure-ai.sh scripts/ensure-ingest.sh scripts/publish-to-dashboard.sh
scripts/ensure-ai.sh

HEALTH="$(curl -sS --max-time 5 "${AI_ANALYZER_URL}/health" || true)"
echo "AI health => ${HEALTH}"
if ! echo "${HEALTH}" | grep -q '"database"[[:space:]]*:[[:space:]]*true'; then
  echo "ERROR: AI analyzer is up but PostgreSQL is not reachable (database:false)."
  exit 1
fi

ensure_build_ingested() {
  local encoded
  encoded="$(python3 -c "import urllib.parse,os; print(urllib.parse.quote(os.environ.get('JOB_NAME','Devops-project')))")"
  local verify
  verify="$(curl -sS --max-time 5 "http://127.0.0.1:${INGEST_PORT}/builds/${encoded}/${BUILD_NUMBER}" || true)"
  echo "Ingest lookup => ${verify}"
  echo "${verify}" | grep -Eq '"found"[[:space:]]*:[[:space:]]*true'
}

if ! ensure_build_ingested; then
  echo "WARN: build ${JOB_NAME} #${BUILD_NUMBER} missing in security_builds — re-running Store Findings publish..."
  export FORCE_INGEST_RESTART=1
  scripts/publish-to-dashboard.sh
  if ! ensure_build_ingested; then
    echo "ERROR: build still missing after re-publish. AI Analysis cannot run."
    exit 1
  fi
fi

echo "Requesting AI analysis for ${JOB_NAME} #${BUILD_NUMBER} at ${AI_ANALYZER_URL}/analyze"

HTTP_CODE=0
RESPONSE=""
for attempt in 1 2 3; do
  set +e
  RESPONSE="$(curl -sS --max-time 120 -w '\n%{http_code}' -X POST "${AI_ANALYZER_URL}/analyze" \
    -H 'Content-Type: application/json' \
    -d "{\"jobName\":\"${JOB_NAME}\",\"buildNumber\":${BUILD_NUMBER}}")"
  CURL_RC=$?
  set -e
  if [ "${CURL_RC}" -ne 0 ]; then
    echo "WARN: curl failed (rc=${CURL_RC}) on attempt ${attempt}/3 — restarting AI..."
    scripts/ensure-ai.sh || true
    sleep 2
    continue
  fi
  HTTP_CODE="$(echo "${RESPONSE}" | tail -n 1)"
  RESPONSE="$(echo "${RESPONSE}" | sed '$d')"
  echo "HTTP ${HTTP_CODE}"
  echo "${RESPONSE}"
  if echo "${RESPONSE}" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'; then
    echo "AI analysis OK"
    exit 0
  fi
  if echo "${RESPONSE}" | grep -q 'No ingested build'; then
    echo "WARN: analyze 404 — forcing re-publish then retry"
    export FORCE_INGEST_RESTART=1
    scripts/publish-to-dashboard.sh || true
  fi
  sleep 2
done

echo "ERROR: AI analysis failed after retries"
echo "Last HTTP status: ${HTTP_CODE}"
echo "Last body: ${RESPONSE}"
exit 1
