# Jenkins configuration (plugins, tools, SonarQube, credentials)

This is the **manual Jenkins UI / agent** setup required by this project’s `Jenkinsfile`. Complete it after hosts exist ([../ansible/README.md](../ansible/README.md)) and before relying on a green build ([SETUP_GUIDE.md](SETUP_GUIDE.md)).

---

## 1. Jenkins plugins to install

**Manage Jenkins → Plugins → Available** (names may vary slightly by Jenkins version):

| Plugin | Why this project needs it |
|--------|---------------------------|
| **Pipeline** | Declarative `Jenkinsfile` |
| **Pipeline: Stage View** / Blue Ocean (optional) | Easier stage visualization |
| **Git** | `git` checkout step |
| **Credentials** | Store secrets |
| **Credentials Binding** | `withCredentials`, `credentials('id')` |
| **SonarQube Scanner** | `withSonarQubeEnv('sonarqube-server')` |
| **OWASP Dependency-Check** | `dependencyCheckPublisher` (and related steps) |
| **Timestamper** | `timestamps()` in `options` |
| **Docker Pipeline** / Docker-related (optional) | Helpful if you extend Docker agents |
| **Plain Credentials** | Secret text / secret file types |

Install → restart Jenkins if prompted.

---

## 2. Tools that must exist on the agent OS

These are **not** Jenkins plugins. Install on the node that runs the job (`agent any` in this lab = the Jenkins host).

| Tool | Expected location / note |
|------|--------------------------|
| `git`, `curl`, `python3` | On `PATH` |
| `node` / `npm` | Node **20** recommended |
| `docker` | Jenkins user in `docker` group |
| SonarScanner CLI | `/opt/sonar-scanner-6.2.1.4610-linux-x64` (or change `SONAR_SCANNER_HOME` in Jenkinsfile) |
| OWASP Dependency-Check | `/opt/dependency-check/bin/dependency-check.sh` |
| Data dir for OWASP | `/var/lib/jenkins/.dependency-check` (writable by Jenkins) |
| `gitleaks` | On `PATH` |
| `trivy` | On `PATH` |
| `cosign` | On `PATH` |
| `kubectl` | On `PATH` |
| `argocd` | On `PATH` |
| kubeconfig | `/var/lib/jenkins/.kube/config` (owner `jenkins`, mode `0600`) |
| SonarQube server | Reachable; often `docker start sonarqube` on the same LAN |

Suppressions file used by the pipeline: `security/dependency-check-suppressions.xml`.

---

## 3. SonarQube server in Jenkins

1. **Manage Jenkins → System** (or **Configuration**) → **SonarQube servers**.  
2. Add a server:
   - **Name:** `sonarqube-server` ← **must match exactly** (used in `withSonarQubeEnv('sonarqube-server')`)  
   - **Server URL:** e.g. `http://192.168.10.149:9000`  
   - **Server authentication token:** select credential `sonarqube-token` (create it first — §4)  
3. Under **Tools**, ensure a SonarScanner installation exists if you use Jenkins tool auto-install; this lab primarily uses the CLI on disk via `SONAR_SCANNER_HOME`.

### SonarQube project

| Setting | Value |
|---------|-------|
| Project key | `devsecops-simple-shop` |
| Properties file in repo | `sonar-project.properties` |
| Token permission | Execute Analysis (and Create Projects if the project does not exist yet) |

Token UI: SonarQube → My Account → Security → Generate Tokens.

If analysis fails with connection errors, on the Sonar host run:

```bash
docker ps -a | grep sonarqube
docker start sonarqube
```

---

## 4. Credentials — create every ID exactly

**Manage Jenkins → Credentials → System → Global credentials → Add Credentials**

| ID (exact) | Kind | Used for |
|------------|------|----------|
| `github-credentials` | Username + password (or PAT as password) | Git checkout of the pipeline repo |
| `sonarqube-token` | **Secret text** | Sonar analysis token |
| `nvd-api-key` | **Secret text** | OWASP Dependency-Check NVD API ([request key](https://nvd.nist.gov/developers/request-an-api-key)) |
| `dockerhub-credentials` | Username + password | `docker login` + Cosign push to Docker Hub |
| `cosign-private-key` | **Secret file** | Contents of `cosign.key` ([COSIGN.md](COSIGN.md)) |
| `cosign-password` | **Secret text** | Passphrase for that key |
| `argocd-admin-password` | **Secret text** | `argocd login` as `admin` |
| `jenkins-db-password` | **Secret text** | Postgres user `jenkins` → env `JENKINS_DB_PASSWORD` |
| `huggingface-api-key` | **Secret text** | Hugging Face token → env `HUGGINGFACE_API_KEY` |

A fill-in checklist lives at [`vars/credentials.yml.example`](../vars/credentials.yml.example) — copy it privately; **never commit real secrets**.

### How the Jenkinsfile binds DB + HF

```groovy
environment {
  JENKINS_DB_PASSWORD  = credentials('jenkins-db-password')
  HUGGINGFACE_API_KEY  = credentials('huggingface-api-key')
  // ...
}
```

---

## 5. Environment variables (optional)

Pipeline already hard-codes safe local ingest/AI URLs. Prefer **not** setting a global `INGEST_URL` to another machine’s IP (that caused connection refused in earlier builds).

| Variable | Recommended | Notes |
|----------|-------------|-------|
| `INGEST_URL` | *(unset)* or `http://127.0.0.1:4200/ingest/build` | Pipeline forces localhost |
| `AI_ANALYZER_URL` | `http://127.0.0.1:4300` | Same |
| `HUGGINGFACE_MODEL` | `Qwen/Qwen2.5-7B-Instruct:fastest` | Override if desired |
| `JENKINS_DB_HOST` | `127.0.0.1` on agent | K8s ConfigMaps use cluster-reachable IP |
| `ARGOCD_SERVER` | set in Jenkinsfile | e.g. `192.168.10.149:30443` |

---

## 6. Create the Pipeline job

1. **New Item** → **Pipeline** → name e.g. `Devops-project`.  
2. Pipeline definition: **Pipeline script from SCM**  
   - SCM: Git  
   - URL: your fork  
   - Credentials: `github-credentials`  
   - Branch: `*/main`  
   - Script path: `Jenkinsfile`  
3. Save → **Build Now**.

### Important Jenkinsfile constants (edit for your fork)

| Constant | Lab value |
|----------|-----------|
| `GIT_REPO` | `https://github.com/vanelnara/DevSecops-Project.git` |
| `DOCKER_IMAGE` | `sneproject/devsecops-project` |
| `DASHBOARD_IMAGE` | `sneproject/devsecops-dashboard` |
| `AI_IMAGE` | `sneproject/devsecops-ai` |
| `SONAR_PROJECT_KEY` | `devsecops-simple-shop` |
| `SONAR_CREDENTIALS_ID` | `sonarqube-token` |
| `KUBE_NAMESPACE` | `devsecops` |
| `ARGOCD_SERVER` | `192.168.10.149:30443` |
| `ARGOCD_APP_NAME` | `devsecops-simple-shop` |
| `INGEST_URL` | `http://127.0.0.1:4200/ingest/build` |
| `AI_ANALYZER_URL` | `http://127.0.0.1:4300` |

---

## 7. Security services stages (dashboard + AI)

After Kubernetes deploy, the pipeline:

1. Runs `scripts/ensure-ingest.sh` — host Node process on **:4200**, DB `127.0.0.1`  
2. Runs `scripts/ensure-ai.sh` — host Node process on **:4300**  
3. Optionally starts the wider stack via `scripts/ensure-security-services.sh`  
4. Publishes reports with `scripts/publish-to-dashboard.sh`  
5. Calls `scripts/trigger-ai-analysis.sh` → `POST /analyze`  

Details: [JENKINS_DASHBOARD_SETUP.md](JENKINS_DASHBOARD_SETUP.md) and [SECURITY_DASHBOARD_BACKEND.md](SECURITY_DASHBOARD_BACKEND.md).

Dashboard login (lab): **`admin` / `admin`**.

---

## 8. Argo CD from Jenkins

Deploy stage logs into Argo using:

- Server: `ARGOCD_SERVER`  
- User: `admin`  
- Password: credential `argocd-admin-password`  
- Flags typically include `--insecure --grpc-web`  

It syncs the shop app and related dashboard/AI apps. Ensure Application manifests point at **your** Git repo before expecting sync to succeed.

---

## 9. Post-build

- `reports/**/*` archived  
- Stage outcomes logged to Postgres via `scripts/log-to-postgresql.sh` when DB is reachable  

---

## 10. Quick verification commands (on the agent)

```bash
curl -sS http://127.0.0.1:4200/health
curl -sS http://127.0.0.1:4300/health
curl -sS http://127.0.0.1:4100/api/health || true
argocd version --client
kubectl get applications -n argocd
kubectl get svc -n devsecops
```

Healthy ingest includes `"database":true`. Healthy AI includes `"status":"ok"`.
