#!/usr/bin/env bash
# Trigger Hugging Face AI analysis for a stored build (called from Jenkins).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

export AI_PORT="${AI_PORT:-4300}"
export AI_ANALYZER_URL="http://127.0.0.1:${AI_PORT}"
export AI_TIMEOUT_MS="${AI_TIMEOUT_MS:-60000}"
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

chmod +x scripts/ensure-ai.sh
scripts/ensure-ai.sh

HEALTH="$(curl -sS --max-time 5 "${AI_ANALYZER_URL}/health" || true)"
echo "AI health => ${HEALTH}"
if ! echo "${HEALTH}" | grep -q '"database"[[:space:]]*:[[:space:]]*true'; then
  echo "ERROR: AI analyzer is up but PostgreSQL is not reachable (database:false)."
  echo "Check JENKINS_DB_PASSWORD / Postgres on ${JENKINS_DB_HOST}:${JENKINS_DB_PORT}"
  exit 1
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
  echo "WARN: analyze did not return ok:true (attempt ${attempt}/3)"
  sleep 2
done

echo "ERROR: AI analysis failed after retries"
echo "Last HTTP status: ${HTTP_CODE}"
echo "Last body: ${RESPONSE}"
if echo "${RESPONSE}" | grep -q 'No ingested build'; then
  echo "Hint: Store Findings did not ingest this build into PostgreSQL before AI Analysis."
fi
exit 1
