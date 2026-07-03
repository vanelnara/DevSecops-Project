#!/usr/bin/env bash
# Push devsecops-project to GitHub (run from your PC or server2)
# SECURITY: Use a GitHub Personal Access Token — never commit passwords
#
# Usage:
#   export GITHUB_TOKEN=your_personal_access_token
#   bash scripts/push-to-github.sh

set -euo pipefail
cd "$(dirname "$0")/.."

REPO_URL="https://github.com/vanelnara/DevSecops-Project.git"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ERROR: Set GITHUB_TOKEN environment variable (GitHub Personal Access Token)"
  echo "Create one at: https://github.com/settings/tokens (repo scope)"
  exit 1
fi

git init -b main 2>/dev/null || git checkout main 2>/dev/null || true
git add .
git status
git commit -m "DevSecOps project: microservice, Jenkinsfile, k8s manifests" || true

git remote remove origin 2>/dev/null || true
git remote add origin "https://${GITHUB_TOKEN}@github.com/vanelnara/DevSecops-Project.git"
git push -u origin main --force

echo "Pushed to ${REPO_URL}"
