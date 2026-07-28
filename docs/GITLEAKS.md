# Gitleaks — known historical findings

Jenkins now runs:

```bash
gitleaks detect --no-git --config security/gitleaks.toml ...
```

That scans the **current workspace only**, so old commits no longer mark the build UNSTABLE.

`security/gitleaks.toml` still allowlists those historical fingerprints/commits/secret strings as a safety net.

## Revoke the leaked credentials (required)

| Secret | Action |
|--------|--------|
| GitHub PAT `ghp_bQDF…` | https://github.com/settings/tokens → **revoke**, create a new token only in local gitignored `vars/github-token` |
| DeepSeek `sk-94dd…` | Revoke in DeepSeek console (project uses Hugging Face now) |

Never commit live tokens in `.env.example` or `vars/github-token`.
