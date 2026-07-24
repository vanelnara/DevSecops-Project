# SentinelOps Security Dashboard

A React and Express dashboard for visualizing DevSecOps pipeline health,
security findings, scanner coverage, deployment activity, and AI-assisted
remediation.

The current version uses realistic mock API data. PostgreSQL ingestion and a
real AI provider are intentionally isolated behind the API so they can be
connected in the next phase without redesigning the frontend.

## Run locally

```bash
npm install
npm run dev
```

- Dashboard: `http://localhost:5173`
- API health: `http://localhost:4100/api/health`

Set Postgres + AI env vars (see `../.env.example` and `../docs/SECURITY_DASHBOARD_BACKEND.md`).
When builds exist in PostgreSQL, `/api/dashboard` serves live data. Otherwise it falls back to mock data.

## Production build

```bash
npm run build
npm start
```

The Express server serves the generated React application on port `4100`.
Set `DASHBOARD_API_PORT` to use another port.

## API boundary

- `GET /api/dashboard` — aggregated pipeline, finding, control, and AI data (Postgres-backed)
- `POST /api/ai/chat` — proxies to the DeepSeek AI analyzer service
- `GET /api/health` — backend + database health check

## Backend services

- `services/ingest-bridge` — Jenkins report ingest on `:4200`
- `services/ai-analyzer` — DeepSeek analysis on `:4300`
- `db/migrations/001_security_dashboard.sql` — schema on the shared `jenkins` database

