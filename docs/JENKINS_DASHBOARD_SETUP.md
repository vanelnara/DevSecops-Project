# Jenkins configuration for Security Dashboard + AI

Pipeline order at the end:

1. … existing scanners / build / deploy …
2. **Store Security Findings** → uploads reports to ingest → PostgreSQL  
3. **AI Security Analysis** → DeepSeek analyzes DB findings → writes `ai_analyses`  
4. Open the dashboard UI to visualize risk, findings, and AI verdict  

Stage logging to PostgreSQL (`log-to-postgresql.sh`) still runs during every earlier stage.

---

## A. Services that must be running

On a host reachable from the Jenkins agent:

| Service | Port | Check |
|---------|------|-------|
| PostgreSQL | 5432 | `psql -h 127.0.0.1 -U jenkins -d jenkins` |
| ingest-bridge | 4200 | `curl http://<host>:4200/health` |
| ai-analyzer | 4300 | `curl http://<host>:4300/health` |
| security-dashboard | 4100 / 5173 | browser |

Apply schema once:

```bash
PGPASSWORD='YOUR_DB_PASSWORD' psql -h 127.0.0.1 -U jenkins -d jenkins \
  -f db/migrations/001_security_dashboard.sql
```

---

## B. Jenkins environment variables

**Manage Jenkins → System → Global properties → Environment variables**  
(or set them on the agent / in the job)

| Name | Example | Required |
|------|---------|----------|
| `JENKINS_DB_HOST` | `127.0.0.1` | yes (existing logger) |
| `JENKINS_DB_PORT` | `5432` | yes |
| `JENKINS_DB_NAME` | `jenkins` | yes |
| `JENKINS_DB_USER` | `jenkins` | yes |
| `JENKINS_DB_PASSWORD` | password you set with `ALTER USER` | yes |
| `INGEST_URL` | `http://192.168.x.x:4200/ingest/build` | yes |
| `AI_ANALYZER_URL` | `http://192.168.x.x:4300` | yes |
| `INGEST_TOKEN` | shared secret (optional) | no |

If ingest/AI run **on the same Jenkins server**, keep:

```text
INGEST_URL=http://127.0.0.1:4200/ingest/build
AI_ANALYZER_URL=http://127.0.0.1:4300
```

If they run on another machine, use that machine’s IP (Jenkins agent must reach it).

---

## C. Optional Jenkins credential for ingest token

If you set `INGEST_TOKEN` on the bridge:

1. Jenkins → Manage Credentials → Add **Secret text**
2. ID: `ingest-token`
3. In the job, bind it to env `INGEST_TOKEN`

Otherwise leave `INGEST_TOKEN` empty on both sides.

---

## D. DeepSeek key (on the AI service host, not Jenkins)

On the machine running `services/ai-analyzer`:

```bash
export DEEPSEEK_API_KEY='sk-...'
export JENKINS_DB_PASSWORD='YOUR_DB_PASSWORD'
cd services/ai-analyzer
npm run dev
```

Jenkins only calls `AI_ANALYZER_URL/analyze`. It does **not** need the DeepSeek key.

---

## E. Network checklist

From the **Jenkins agent**:

```bash
curl -sS http://127.0.0.1:4200/health
curl -sS http://127.0.0.1:4300/health
PGPASSWORD='YOUR_DB_PASSWORD' psql -h 127.0.0.1 -U jenkins -d jenkins -c 'SELECT 1'
```

Install on the agent if missing: `curl`, `psql` (`postgresql-client`), `python3`.

---

## F. What each new stage does

### Store Security Findings
- Reads `reports/gitleaks`, `reports/trivy`, `reports/dependency-check`
- POSTs to ingest-bridge
- Writes `security_builds`, `findings`, `pipeline_stages` in PostgreSQL
- Also appends to `pipeline_runs` (same DB your older stages use)

### AI Security Analysis
- POSTs `{ jobName, buildNumber }` to ai-analyzer
- AI loads findings/logs from PostgreSQL
- Calls DeepSeek and stores verdict in `ai_analyses`

### Dashboard
- No Jenkins config needed beyond having data in DB
- Open `http://<dashboard-host>:5173` (dev) or `:4100` (prod)
- Metrics/risk/AI panel come from PostgreSQL

---

## G. After a pipeline run

1. Jenkins build finishes with the two new green stages  
2. Check DB:

```sql
SELECT build_number, status, risk_score, duration_seconds
FROM security_builds ORDER BY build_number DESC LIMIT 5;

SELECT finding_key, severity, source, title
FROM findings WHERE build_number = <N>;

SELECT verdict, confidence, model
FROM ai_analyses WHERE build_number = <N>;
```

3. Refresh the dashboard — you should see that build’s risk, alerts, duration, and AI verdict.
