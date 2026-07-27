# Jenkins: automated security services + AI dashboard

## Pipeline order (end of job)

After **Deploy to Kubernetes**:

1. **Start Security Services** — starts in background (if not healthy):
   - ingest-bridge `:4200`
   - ai-analyzer `:4300`
   - security-dashboard `:4100`
2. **Store Security Findings** — uploads scanner reports → PostgreSQL  
3. **AI Security Analysis** — DeepSeek analyzes stored findings  

Open dashboard: `http://<jenkins-host>:4100`

Services keep running after the build (`nohup`). Next builds skip restart if healthy.

---

## One-time Jenkins setup

### 1. DeepSeek API key (Secret text)

1. Manage Jenkins → Credentials → (global) → Add Credentials  
2. Kind: **Secret text**  
3. Secret: your DeepSeek key  
4. ID: **`deepseek-api-key`** (must match exactly)  
5. Description: DeepSeek API key  

### 2. Database password (already used by pipeline logging)

Keep using the same env var your `log-to-postgresql.sh` stage already uses:

| Name | Value |
|------|--------|
| `JENKINS_DB_PASSWORD` | Postgres password for user `jenkins` |

Also ensure (if not already set):

| Name | Example |
|------|---------|
| `JENKINS_DB_HOST` | `127.0.0.1` |
| `JENKINS_DB_PORT` | `5432` |
| `JENKINS_DB_NAME` | `jenkins` |
| `JENKINS_DB_USER` | `jenkins` |
| `INGEST_URL` | `http://127.0.0.1:4200/ingest/build` |
| `AI_ANALYZER_URL` | `http://127.0.0.1:4300` |

### 3. Apply DB schema once

```bash
export PGPASSWORD="$JENKINS_DB_PASSWORD"
psql -h 127.0.0.1 -U jenkins -d jenkins \
  -f /path/to/DevSecops-Project/db/migrations/001_security_dashboard.sql
```

### 4. Agent requirements

Jenkins agent needs: `node`, `npm`, `curl`, `python3`, `psql`, `nohup`.

---

## Script used by the pipeline

`scripts/ensure-security-services.sh`

- Starts services **one after another**
- Skips if already healthy (avoids “port in use” errors)
- Logs: `~/.devsecops-services/logs/*.log`
- PIDs: `~/.devsecops-services/pids/*.pid`

Manual test as Jenkins user:

```bash
export JENKINS_DB_PASSWORD='...'
export DEEPSEEK_API_KEY='...'
cd /var/lib/jenkins/workspace/Devops-project   # or your checkout
bash scripts/ensure-security-services.sh
```
