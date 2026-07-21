#!/usr/bin/env bash
# Push devsecops-project to GitHub — fully automated on server2
#
# One-time setup (token stays LOCAL only — never committed):
#   echo "ghp_YOUR_TOKEN" > vars/github-token
#   chmod 600 vars/github-token
#
# Then every time:
#   bash scripts/push-to-github.sh

set -euo pipefail
cd "$(dirname "$0")/.."

sed -i 's/\r$//' scripts/*.sh 2>/dev/null || true

GIT_USER_NAME="vanelnara"
GIT_USER_EMAIL="vanelnara177@gmail.com"
REPO_OWNER="vanelnara"
REPO_NAME="DevSecops-Project"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
DEFAULT_BRANCH="main"
TOKEN_FILE="vars/github-token"

if [[ -z "${GITHUB_TOKEN:-}" && -f "${TOKEN_FILE}" ]]; then
  GITHUB_TOKEN="$(tr -d '\r\n' < "${TOKEN_FILE}")"
  export GITHUB_TOKEN
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ERROR: GitHub token not found."
  echo "  echo 'ghp_YOUR_TOKEN' > ${TOKEN_FILE} && chmod 600 ${TOKEN_FILE}"
  exit 1
fi

git init -b "${DEFAULT_BRANCH}" 2>/dev/null || git checkout "${DEFAULT_BRANCH}" 2>/dev/null || true
git config user.name "${GIT_USER_NAME}"
git config user.email "${GIT_USER_EMAIL}"

# NEVER commit secrets — remove from index if tracked
git rm --cached -f vars/github-token vars/credentials.yml 2>/dev/null || true

# Stage all files except secret files
git add -A
git reset HEAD vars/github-token vars/credentials.yml 2>/dev/null || true

# Safety check — abort if token would be committed
if git diff --cached --name-only | grep -qE 'vars/github-token|vars/credentials.yml'; then
  echo "ERROR: Secret file staged for commit. Aborting."
  git reset HEAD vars/github-token vars/credentials.yml 2>/dev/null || true
  exit 1
fi

git status

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -m "DevSecOps: update microservice, pipeline, and k8s manifests"
fi

git remote remove origin 2>/dev/null || true
git remote add origin "https://${GITHUB_TOKEN}@github.com/${REPO_OWNER}/${REPO_NAME}.git"
git push -u origin "${DEFAULT_BRANCH}"

echo "Done — pushed to ${REPO_URL}"
