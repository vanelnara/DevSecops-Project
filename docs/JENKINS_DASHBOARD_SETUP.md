# Jenkins: automated security services + AI dashboard

## Pipeline order (end of job)

After **Deploy to Kubernetes**:

1. **Start Security Services** — starts in background (if not healthy):
   - ingest-bridge `:4200`
   - ai-analyzer `:4300`
   - security-dashboard `:4100`
2. **Store Security Findings** — uploads scanner reports → PostgreSQL  
3. **AI Security Analysis** — Hugging Face analyzes stored findings  

Open dashboard: `http://<jenkins-host>:4100`

Services keep running after the build (`nohup`). Next builds skip restart if healthy.

---

## One-time Jenkins setup

### 1. Create these Secret text credentials

| Credential ID | Secret value | Used as |
|---------------|--------------|---------|
| **`jenkins-db-password`** | Postgres password for user `jenkins` | `JENKINS_DB_PASSWORD` |
| **`huggingface-api-key`** | Hugging Face token | `HUGGINGFACE_API_KEY` |

Jenkins UI: **Manage Jenkins → Credentials → (global) → Add Credentials → Secret text**

Create the HF token at https://huggingface.co/settings/tokens

The Jenkinsfile binds them with:

```groovy
JENKINS_DB_PASSWORD = credentials('jenkins-db-password')
HUGGINGFACE_API_KEY = credentials('huggingface-api-key')
AI_PROVIDER         = 'huggingface'
```

### 2. Optional non-secret env vars

| Name | Example |
|------|---------|
| `INGEST_URL` | `http://192.168.10.147:4200/ingest/build` |
| `AI_ANALYZER_URL` | `http://127.0.0.1:4300` |
| `HUGGINGFACE_MODEL` | `Qwen/Qwen2.5-7B-Instruct:fastest` |

### 3. Apply DB migration once

```bash
psql -h 127.0.0.1 -U jenkins -d jenkins -f db/migrations/001_security_dashboard.sql
```

---

## Local manual start

```bash
export JENKINS_DB_PASSWORD='...'
export HUGGINGFACE_API_KEY='hf_...'
scripts/ensure-security-services.sh
```
