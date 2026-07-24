#!/usr/bin/env bash
# Seed a sample build into the ingest bridge for local dashboard testing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

mkdir -p "${TMP}/gitleaks" "${TMP}/trivy" "${TMP}/dependency-check"

cat > "${TMP}/gitleaks/report.json" <<'JSON'
[
  {
    "RuleID": "generic-api-key",
    "Description": "Detected generic API key",
    "File": "scripts/push-to-github.sh",
    "Fingerprint": "demo-secret-1"
  }
]
JSON

cat > "${TMP}/trivy/report.json" <<'JSON'
{
  "Results": [
    {
      "Target": "sneproject/devsecops-project:demo",
      "Vulnerabilities": [
        {
          "VulnerabilityID": "CVE-2024-99999",
          "PkgName": "openssl",
          "Severity": "CRITICAL",
          "Title": "Demo critical vulnerability in openssl"
        },
        {
          "VulnerabilityID": "CVE-2024-88888",
          "PkgName": "busybox",
          "Severity": "HIGH",
          "Title": "Demo high vulnerability in busybox"
        }
      ]
    }
  ]
}
JSON

cat > "${TMP}/dependency-check/dependency-check-report.json" <<'JSON'
{
  "dependencies": [
    {
      "fileName": "express@4.21.0",
      "vulnerabilities": [
        {
          "name": "CVE-2024-77777",
          "description": "Demo OWASP finding",
          "cvssv3": { "baseScore": 7.5 }
        }
      ]
    }
  ]
}
JSON

export JOB_NAME="${JOB_NAME:-Devops-project}"
export BUILD_NUMBER="${BUILD_NUMBER:-101}"
export STATUS="${STATUS:-UNSTABLE}"
export BRANCH=main
export COMMIT_SHA=demodemo
export IMAGE_TAG=sneproject/devsecops-project:101
export REPORTS_DIR="${TMP}"
export DURATION_SECONDS=374
export STAGES_JSON='[
  {"name":"Checkout","status":"SUCCESS","durationSeconds":4},
  {"name":"Unit Tests","status":"SUCCESS","durationSeconds":13},
  {"name":"SAST","status":"SUCCESS","durationSeconds":48},
  {"name":"Dependency Scan","status":"SUCCESS","durationSeconds":156},
  {"name":"Gitleaks","status":"UNSTABLE","durationSeconds":2},
  {"name":"Docker Build","status":"SUCCESS","durationSeconds":38},
  {"name":"Trivy","status":"SUCCESS","durationSeconds":112},
  {"name":"Cosign","status":"SUCCESS","durationSeconds":18},
  {"name":"K8s Deploy","status":"SUCCESS","durationSeconds":31},
  {"name":"Dashboard Publish","status":"SUCCESS","durationSeconds":3}
]'
export INGEST_URL="${INGEST_URL:-http://127.0.0.1:4200/ingest/build}"

bash "${ROOT}/scripts/publish-to-dashboard.sh"
echo "Seeded ${JOB_NAME} #${BUILD_NUMBER}. Refresh the dashboard."
