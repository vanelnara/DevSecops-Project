# Security data plane (PostgreSQL + ingest + DeepSeek)

This connects the Jenkins DevSecOps pipeline to the SentinelOps dashboard.

```
Jenkins scanners (Gitleaks / Trivy / OWASP)
        │
        ▼
scripts/publish-to-dashboard.sh   ← new pipeline stage
        │
        ▼
services/ingest-bridge :4200      ← parses reports, stores builds
        │
        ├──► PostgreSQL (existing jenkins DB)
        │
        └──► services/ai-analyzer :4300  ← DeepSeek analysis
                    │
                    ▼
         security-dashboard :4100 / :5173
```

## 1. Prepare PostgreSQL

Use the existing Jenkins database (`jenkins`) or start a local one:

```bash
cp .env.example .env
# edit JENKINS_DB_PASSWORD and DEEPSEEK_API_KEY

docker compose up -d postgres
# or against your existing DB:
psql -h 127.0.0.1 -U jenkins -d jenkins -f db/migrations/001_security_dashboard.sql
```

## 2. Start backend services

```bash
# Terminal A — ingest bridge
cd services/ingest-bridge
npm install
npm run dev

# Terminal B — DeepSeek AI analyzer
cd services/ai-analyzer
npm install
# set DEEPSEEK_API_KEY first
npm run dev

# Terminal C — dashboard
cd security-dashboard
npm install
npm run dev
```

Or everything with Docker:

```bash
docker compose up --build
```

- Dashboard API: http://localhost:4100  
- Ingest: http://localhost:4200/health  
- AI: http://localhost:4300/health  
- Vite UI: http://localhost:5173  

## 3. DeepSeek API key

1. Create a key at https://platform.deepseek.com  
2. Set `DEEPSEEK_API_KEY` in `.env` / Jenkins / shell  
3. Model default: `deepseek-chat`

Without a key, the AI service still stores a deterministic local fallback analysis so the dashboard keeps working.

## 4. Jenkins configuration

New stage: **Publish to Security Dashboard** (after Deploy).

Set on the Jenkins agent / job:

| Variable | Example |
|----------|---------|
| `INGEST_URL` | `http://<dashboard-host>:4200/ingest/build` |
| `INGEST_TOKEN` | optional shared secret |
| `JENKINS_DB_*` | already used by `log-to-postgresql.sh` |

Each build upserts:

- `security_builds` — one row per build with risk score + duration  
- `pipeline_stages` — per-stage status/duration  
- `findings` — normalized Gitleaks / Trivy / OWASP issues  
- `ai_analyses` — DeepSeek verdict for that build  

## 5. Manual publish (without waiting for a full pipeline)

```bash
export JOB_NAME=Devops-project
export BUILD_NUMBER=99
export STATUS=UNSTABLE
export COMMIT_SHA=$(git rev-parse HEAD)
export REPORTS_DIR=reports
bash scripts/publish-to-dashboard.sh
```

## 6. What the dashboard shows

| Metric | Source |
|--------|--------|
| Risk score / severities | Computed from ingested findings |
| Pipeline table | Every `security_builds` row (each Jenkins build) |
| Build duration | `DURATION_SECONDS` from publish + stage timings |
| Priority alerts | Latest build findings |
| AI panel / chat | `ai_analyses` + DeepSeek `/chat` |
