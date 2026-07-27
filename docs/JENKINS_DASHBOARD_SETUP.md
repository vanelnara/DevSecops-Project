# Jenkins: automated security services + AI dashboard

> Broader install steps: [SETUP_GUIDE.md](SETUP_GUIDE.md) · [JENKINS_SETUP.md](JENKINS_SETUP.md) · [../ansible/README.md](../ansible/README.md)

## Pipeline order (end of job)

After **Deploy to Kubernetes**:

1. **Start Security Services** — ensures (and starts if needed):
   - ingest-bridge `:4200` via `scripts/ensure-ingest.sh`
   - ai-analyzer `:4300` via `scripts/ensure-ai.sh`
   - optional full stack via `scripts/ensure-security-services.sh` (dashboard `:4100`)
2. **Store Security Findings** — uploads scanner reports → PostgreSQL (`scripts/publish-to-dashboard.sh`, which also re-checks ingest)
3. **AI Security Analysis** — Hugging Face analyzes stored findings (`scripts/trigger-ai-analysis.sh`, which also re-checks AI)

Open dashboard:

- Jenkins host: `http://<jenkins-host>:4100`
- Kubernetes NodePort: `http://<node-ip>:30410`

Default login: **`admin` / `admin`** (change in Settings).

Host processes keep running after the build (`nohup` under `~/.devsecops-services/`). Later builds skip restart when health checks pass.

---

## One-time Jenkins setup

### 1. Create these Secret text credentials

| Credential ID | Secret value | Used as |
|---------------|--------------|---------|
| **`jenkins-db-password`** | Postgres password for user `jenkins` | `JENKINS_DB_PASSWORD` |
| **`huggingface-api-key`** | Hugging Face token | `HUGGINGFACE_API_KEY` |

Also required for the full pipeline (see [JENKINS_SETUP.md](JENKINS_SETUP.md)):  
`github-credentials`, `sonarqube-token`, `nvd-api-key`, `dockerhub-credentials`, `cosign-private-key`, `cosign-password`, `argocd-admin-password`.

Jenkins UI: **Manage Jenkins → Credentials → (global) → Add Credentials → Secret text**

Create the HF token at https://huggingface.co/settings/tokens

The Jenkinsfile binds DB/HF with:

```groovy
JENKINS_DB_PASSWORD = credentials('jenkins-db-password')
HUGGINGFACE_API_KEY = credentials('huggingface-api-key')
AI_PROVIDER         = 'huggingface'
```

### 2. Ingest / AI URLs

The pipeline **forces** agent-local endpoints:

- `INGEST_URL=http://127.0.0.1:4200/ingest/build`
- `AI_ANALYZER_URL=http://127.0.0.1:4300`

Do **not** set a Jenkins global `INGEST_URL` to another LAN IP (e.g. `http://192.168.10.147:4200/...`); that previously caused `Connection refused` when nothing listened there.

Optional overrides:

| Name | Example |
|------|---------|
| `HUGGINGFACE_MODEL` | `Qwen/Qwen2.5-7B-Instruct:fastest` |
| `DASHBOARD_API_PORT` | `4100` |

### 3. Apply DB migrations once

```bash
export JENKINS_DB_PASSWORD='...'
scripts/apply-db-migrations.sh
# or:
psql -h 127.0.0.1 -U jenkins -d jenkins -f db/migrations/001_security_dashboard.sql
psql -h 127.0.0.1 -U jenkins -d jenkins -f db/migrations/002_dashboard_users.sql
```

---

## Local manual start

```bash
export JENKINS_DB_PASSWORD='...'
export HUGGINGFACE_API_KEY='hf_...'
scripts/ensure-ingest.sh
scripts/ensure-ai.sh
# or full stack:
scripts/ensure-security-services.sh
```

Health checks:

```bash
curl -sS http://127.0.0.1:4200/health
curl -sS http://127.0.0.1:4300/health
curl -sS http://127.0.0.1:4100/api/health
```
