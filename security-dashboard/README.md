# SentinelOps Security Dashboard

React + Express dashboard that visualizes **real Jenkins pipeline security results** from PostgreSQL.

There is **no mock data**. Until builds are ingested, the UI shows empty states.

**Full lab setup** (Jenkins, Ansible, Argo CD, AI): see the root [README.md](../README.md) and [docs/SETUP_GUIDE.md](../docs/SETUP_GUIDE.md).

**Default login (lab):** `admin` / `admin` — change in Settings after first login.

**Ports:** API `:4100` (K8s NodePort **30410**). Dev UI `:5173`.

## Run locally

```bash
npm install
export JENKINS_DB_HOST=127.0.0.1
export JENKINS_DB_PASSWORD='your-db-password'
export AI_ANALYZER_URL=http://127.0.0.1:4300
npm run dev
```

- UI: http://localhost:5173  
- API: http://localhost:4100  

## Interactive views

- **Security overview** — risk, trend, alerts for the selected build  
- **Pipelines** — all ingested builds, status filter, click for stage/finding detail  
- **Findings** — severity/status/source filters, status updates saved to Postgres  
- **AI investigations** — Hugging Face verdict + security copilot chat against the selected build  

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | API + DB health |
| GET | `/api/dashboard?job=&build=` | Overview payload for a build |
| GET | `/api/builds` | List ingested builds |
| GET | `/api/builds/:job/:build` | Build detail (stages, findings, AI) |
| GET | `/api/findings?...` | Filtered findings |
| PATCH | `/api/findings/:id` | Update finding status |
| GET | `/api/activity` | Activity feed |
| POST | `/api/ai/chat` | Chat via AI analyzer |
| POST | `/api/ai/analyze` | Re-run AI analysis |

## Data source

Filled by Jenkins stages **Store Security Findings** and **AI Security Analysis** through `services/ingest-bridge` into the shared `jenkins` PostgreSQL database.
