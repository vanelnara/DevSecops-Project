# Security data plane (PostgreSQL + ingest + Hugging Face)

```
Jenkins scanners → reports/
        │
        ▼
services/ingest-bridge :4200  →  PostgreSQL (findings, builds, stages)
        │
        └──► services/ai-analyzer :4300  ← Hugging Face analysis
                    │
                    ▼
        security-dashboard :4100 / :5173
```

## 1. Environment

Copy `.env.example` values into your shell or Jenkins credentials. Never commit real API keys.

## 2. Start services

```bash
# edit JENKINS_DB_PASSWORD and HUGGINGFACE_API_KEY
docker compose up -d
# or (preferred on Jenkins agent — host Node, DB on 127.0.0.1)
scripts/ensure-ingest.sh
scripts/ensure-ai.sh
scripts/ensure-security-services.sh
```

Jenkins pipeline stages call `ensure-ingest.sh` / `ensure-ai.sh` automatically before publish and analyze.

Manual:

```bash
# Terminal A — ingest
cd services/ingest-bridge && npm start

# Terminal B — Hugging Face AI analyzer
cd services/ai-analyzer && npm start

# Terminal C — dashboard
cd security-dashboard && npm run dev
```

## 3. Hugging Face API key

1. Create a token at https://huggingface.co/settings/tokens  
2. Set `HUGGINGFACE_API_KEY` in Jenkins credential ID `huggingface-api-key`  
3. Model default: `Qwen/Qwen2.5-7B-Instruct:fastest`  
4. API: `https://router.huggingface.co/v1/chat/completions`

## 4. Tables

- `security_builds` / `findings` / `pipeline_stages` — ingest output  
- `ai_analyses` — Hugging Face verdict for that build  
- `activity_events` — timeline  

## 5. Dashboard mapping

| UI | Source |
|----|--------|
| Overview metrics | `/api/dashboard` |
| AI panel / chat | `ai_analyses` + analyzer `/chat` |
