#!/usr/bin/env bash
# Trigger Hugging Face AI analysis for a stored build (called from Jenkins).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

export AI_PORT="${AI_PORT:-4300}"
export AI_ANALYZER_URL="http://127.0.0.1:${AI_PORT}"
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

echo "Requesting AI analysis for ${JOB_NAME} #${BUILD_NUMBER} at ${AI_ANALYZER_URL}/analyze"
RESPONSE="$(curl -sS -X POST "${AI_ANALYZER_URL}/analyze" \
  -H 'Content-Type: application/json' \
  -d "{\"jobName\":\"${JOB_NAME}\",\"buildNumber\":${BUILD_NUMBER}}")"

echo "${RESPONSE}"
echo "${RESPONSE}" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'
