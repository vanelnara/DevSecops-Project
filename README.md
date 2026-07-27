# DevSecOps Project — Simple Shop Pipeline

End-to-end **DevSecOps** lab: a Node.js microservice (**Simple Shop**) is tested, scanned, built, signed, and deployed to Kubernetes with **Jenkins**, **SonarQube**, **OWASP Dependency-Check**, **Gitleaks**, **Trivy**, **Cosign**, **Argo CD**, a **PostgreSQL**-backed **SentinelOps** security dashboard, and a **Hugging Face** AI analyzer.

This README is written so someone who is **not** a DevOps specialist can clone the idea, adapt the IPs/credentials, and stand up their own copy.

---

## Table of contents

1. [What you get](#what-you-get)
2. [Architecture](#architecture)
3. [Lab topology (customize these)](#lab-topology-customize-these)
4. [Repository layout](#repository-layout)
5. [Documentation map](#documentation-map)
6. [Ports & URLs cheat sheet](#ports--urls-cheat-sheet)
7. [Default lab credentials](#default-lab-credentials)
8. [Pipeline stages (what Jenkins does)](#pipeline-stages-what-jenkins-does)
9. [Fast path (already have Jenkins + K8s)](#fast-path-already-have-jenkins--k8s)
10. [Where to go next](#where-to-go-next)

---

## What you get

| Piece | Role |
|-------|------|
| `microservice/` | Simple Shop web app (unit-tested, containerized) |
| `Jenkinsfile` | Full CI/CD + security pipeline |
| SonarQube / OWASP / Gitleaks / Trivy / Cosign | SAST, SCA, secrets, image CVE scan, image signing |
| Argo CD + `k8s/` | GitOps deploy of shop, dashboard, and AI |
| PostgreSQL (`jenkins` DB) | Shared store for pipeline logs, findings, users, AI results |
| Ingest bridge `:4200` | Uploads scanner reports into Postgres |
| AI analyzer `:4300` | Hugging Face analysis of stored findings |
| Security dashboard `:4100` / NodePort `30410` | Login UI, findings, pipelines, AI chat |

---

## Architecture

```text
 Developer ──git push──► GitHub (main)
                            │
                            ▼
                     Jenkins pipeline
         ┌──────────────┬──────────────┬──────────────┐
         │ Unit tests   │ SonarQube    │ OWASP /      │
         │              │              │ Gitleaks     │
         └──────────────┴──────────────┴──────────────┘
                            │
              Docker Hub: sneproject/devsecops-{project,dashboard,ai}
                            │
              Trivy scan ──► Cosign sign
                            │
                            ▼
              Argo CD ──► Kubernetes (ns: devsecops)
                            │
         ┌──────────────────┼──────────────────┐
         │ NodePort 30081   │ NodePort 30410   │ NodePort 30430
         │ Simple Shop      │ Dashboard        │ AI analyzer
         └──────────────────┴──────────────────┘

 Jenkins agent (local services after deploy):
   ingest :4200 ──► PostgreSQL (jenkins DB)
   AI     :4300 ──► PostgreSQL + Hugging Face
   dash   :4100 ──► PostgreSQL (+ AI for chat)
```

---

## Lab topology (customize these)

Our reference lab uses these addresses. **Replace them with yours** in `Jenkinsfile`, `k8s/*/configmap.yaml`, `k8s/sentinelops-config.yaml`, and Argo CD.

| Role | Example (this lab) | Notes |
|------|--------------------|-------|
| Jenkins + Postgres + agent tools | `192.168.10.149` | Often same VM as SonarQube / kube access |
| SonarQube UI | `http://192.168.10.149:9000` | Docker container `sonarqube` on the host |
| Argo CD API | `192.168.10.149:30443` | NodePort / ingress to Argo server |
| Optional LAN ingest | `192.168.10.147:4200` | **Do not** set this as Jenkins global `INGEST_URL`; pipeline uses `127.0.0.1:4200` |
| GitHub repo | `https://github.com/vanelnara/DevSecops-Project.git` | Fork and change `GIT_REPO` / Argo `repoURL` |
| Docker Hub org | `sneproject` | Change image names if you use another registry |

Agent-local services (always on the Jenkins node that runs the job):

| Service | URL |
|---------|-----|
| Ingest | `http://127.0.0.1:4200` |
| AI | `http://127.0.0.1:4300` |
| Dashboard API | `http://127.0.0.1:4100` |
| Postgres | `127.0.0.1:5432` DB `jenkins` / user `jenkins` |

---

## Repository layout

```text
.
├── README.md                          ← you are here
├── Jenkinsfile                        ← CI/CD definition
├── sonar-project.properties
├── docker-compose.yml                 ← local Postgres + ingest + AI + dashboard
├── .env.example
├── ansible/                           ← infra provisioning guide + example playbooks
├── docs/                              ← detailed setup guides
├── db/migrations/                     ← SQL schema for dashboard / findings
├── k8s/                               ← Simple Shop + shared ConfigMap + Argo app
│   ├── dashboard/                     ← SentinelOps dashboard K8s + Argo app
│   └── ai-analyzer/                   ← AI service K8s + Argo app
├── microservice/                      ← Simple Shop application
├── security-dashboard/                ← React + Express UI
├── services/
│   ├── ingest-bridge/                 ← report → Postgres
│   └── ai-analyzer/                   ← Hugging Face analysis
├── scripts/                           ← ensure-*, publish, migrations, etc.
├── security/                          ← gitleaks / OWASP suppressions
└── vars/                              ← credential checklists (examples only)
```

---

## Documentation map

| Document | Audience | Contents |
|----------|----------|----------|
| **[ansible/README.md](ansible/README.md)** | First-time lab builders | Hosts, packages, Ansible inventory/playbooks **or** matching manual steps |
| **[docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md)** | Everyone | Full procedure from empty VMs to green pipeline |
| **[docs/JENKINS_SETUP.md](docs/JENKINS_SETUP.md)** | Jenkins admins | Plugins, tools on the agent, credentials, SonarQube, job creation |
| **[docs/JENKINS_DASHBOARD_SETUP.md](docs/JENKINS_DASHBOARD_SETUP.md)** | Operators | Ingest / AI / dashboard stages and DB password / HF key |
| **[docs/SECURITY_DASHBOARD_BACKEND.md](docs/SECURITY_DASHBOARD_BACKEND.md)** | Developers | Data plane (ingest → Postgres → AI → UI) |
| **[docs/COSIGN.md](docs/COSIGN.md)** | Security | Cosign keypair and Jenkins secret IDs |
| **[security-dashboard/README.md](security-dashboard/README.md)** | Frontend | Local dashboard API routes |
| **[vars/credentials.yml.example](vars/credentials.yml.example)** | Checklist | Every secret you will paste into Jenkins (never commit real values) |

---

## Ports & URLs cheat sheet

| Service | Port | How you reach it |
|---------|------|------------------|
| Simple Shop | **30081** | `http://<any-worker-ip>:30081` |
| Security dashboard | **30410** (K8s) / **4100** (Jenkins host) | `http://<node>:30410` or `http://<jenkins>:4100` |
| AI analyzer | **30430** (K8s) / **4300** (Jenkins host) | Health: `/health` |
| Ingest bridge | **4200** | Jenkins agent only (`127.0.0.1`) |
| Argo CD | **30443** | `https://<argo-host>:30443` |
| SonarQube | **9000** | `http://<sonar-host>:9000` |
| PostgreSQL | **5432** | Host / Jenkins agent |
| Dashboard Vite (dev only) | **5173** | Local `npm run dev` |

---

## Default lab credentials

**Lab only — change immediately in any shared or production-like environment.**

| System | Username | Password / secret |
|--------|----------|-------------------|
| SentinelOps dashboard | `admin` | `admin` (change in **Settings**) |
| Postgres (compose / local examples) | `jenkins` | `jenkins` (or your real password in Jenkins credential `jenkins-db-password`) |
| Argo CD | `admin` | From `argocd-initial-admin-secret` (store in Jenkins as `argocd-admin-password`) |
| SonarQube | (your user) | Token → Jenkins `sonarqube-token` |

---

## Pipeline stages (what Jenkins does)

1. **Checkout** — clone `main`
2. **Unit Tests** — `microservice` `npm ci` + `npm test`
3. **SAST - SonarQube** — project key `devsecops-simple-shop`
4. **Dependency Scan - OWASP** — NVD API via `nvd-api-key`
5. **Secret Detection - Gitleaks**
6. **Docker Build & Push** — shop + dashboard + AI images tagged with `BUILD_NUMBER` and `latest`
7. **Container Scan - Trivy**
8. **Image Signing - Cosign**
9. **Deploy to Kubernetes** — Argo CD sync (kubectl fallback) for shop, dashboard, AI
10. **Start Security Services** — host ingest `:4200` + AI `:4300` (+ optional full stack)
11. **Store Security Findings** — publish reports into Postgres
12. **AI Security Analysis** — Hugging Face analysis for that build

Artifacts under `reports/` are archived on every build.

---

## Fast path (already have Jenkins + K8s)

1. Fork/clone this repo; update GitHub URL, Docker Hub org, and lab IPs.
2. Copy `vars/credentials.yml.example` → fill privately → create **every** Jenkins credential with the **exact IDs** in [docs/JENKINS_SETUP.md](docs/JENKINS_SETUP.md).
3. Apply DB migrations: `scripts/apply-db-migrations.sh` (or see SETUP_GUIDE).
4. Create SonarQube project `devsecops-simple-shop` and point Jenkins Sonar installer name to `sonarqube-server`.
5. Apply / sync Argo apps under `k8s/`, `k8s/dashboard/`, `k8s/ai-analyzer/`.
6. Create a Pipeline job pointing at this `Jenkinsfile` and run it.
7. Open dashboard (`:4100` or NodePort `30410`), login `admin` / `admin`, confirm findings for the build number.

If **Store Findings** or **AI Analysis** fails with *Connection refused* on `:4200` / `:4300`, the agent scripts `scripts/ensure-ingest.sh` and `scripts/ensure-ai.sh` start those services on the Jenkins node (they need `JENKINS_DB_PASSWORD` and Node/npm).

---

## Where to go next

1. **[ansible/README.md](ansible/README.md)** — prepare VMs (Ansible or manual).  
2. **[docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md)** — end-to-end checklist.  
3. **[docs/JENKINS_SETUP.md](docs/JENKINS_SETUP.md)** — plugins, SonarQube, credentials, job.  

Questions about Cosign keys → [docs/COSIGN.md](docs/COSIGN.md).  
Questions about dashboard data → [docs/SECURITY_DASHBOARD_BACKEND.md](docs/SECURITY_DASHBOARD_BACKEND.md).
