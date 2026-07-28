# Gitleaks — known historical findings (rotated)

These fingerprints are allowlisted in `security/gitleaks.toml` so CI can stay green without rewriting published git history.

**You must still rotate/revoke the real secrets in the provider consoles:**

| Finding | Action |
|---------|--------|
| DeepSeek key formerly in `.env.example` | Revoke at DeepSeek dashboard (key is obsolete; project uses Hugging Face now) |
| GitHub PAT formerly in `vars/github-token` | Revoke at https://github.com/settings/tokens and create a new one only in local `vars/github-token` (gitignored) |
| Jenkinsfile `curl --user "${SONAR_TOKEN}:"` | False positive — current Jenkinsfile uses a non-matching form; fingerprint kept for old commits |

Never put live tokens in `.env.example` or commit `vars/github-token`.
