#!/usr/bin/env bash
# Trigger DeepSeek AI analysis for a stored build (called from Jenkins).
set -euo pipefail

AI_URL="${AI_ANALYZER_URL:-http://127.0.0.1:4300}"
JOB_NAME="${JOB_NAME:-${1:-Devops-project}}"
BUILD_NUMBER="${BUILD_NUMBER:-${2:-0}}"

if [ "${BUILD_NUMBER}" = "0" ] || [ -z "${BUILD_NUMBER}" ]; then
  echo "BUILD_NUMBER is required"
  exit 1
fi

echo "Requesting AI analysis for ${JOB_NAME} #${BUILD_NUMBER} at ${AI_URL}/analyze"
RESPONSE="$(curl -sS -X POST "${AI_URL}/analyze" \
  -H 'Content-Type: application/json' \
  -d "{\"jobName\":\"${JOB_NAME}\",\"buildNumber\":${BUILD_NUMBER}}")"

echo "${RESPONSE}"
echo "${RESPONSE}" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'
