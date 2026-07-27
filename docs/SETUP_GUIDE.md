# Complete setup guide (empty lab → green pipeline)

Follow this document top to bottom. When a step says “see Jenkins setup”, open [JENKINS_SETUP.md](JENKINS_SETUP.md). When it says “Ansible”, open [../ansible/README.md](../ansible/README.md).

Estimated time for a first-time builder: **half a day to a day**, depending on whether Kubernetes and Jenkins already exist.

---

## Phase 0 — Decide your topology

Write down your real values (do not commit them):

| Item | Your value | Lab example |
|------|------------|-------------|
| GitHub repo URL | | `https://github.com/vanelnara/DevSecops-Project.git` |
| Docker Hub namespace | | `sneproject` |
| Jenkins / Postgres host | | `192.168.10.149` |
| SonarQube URL | | `http://192.168.10.149:9000` |
| Argo CD host:port | | `192.168.10.149:30443` |
| Postgres password for user `jenkins` | | (secret) |
| Hugging Face token | | `hf_...` |

Fork the GitHub repository. In your fork, search-and-replace lab IPs and image names in:

- `Jenkinsfile` (`GIT_REPO`, `DOCKER_*`, `ARGOCD_SERVER`, …)
- `k8s/**/argocd-application.yaml` (`repoURL`)
- `k8s/sentinelops-config.yaml` and dashboard/AI ConfigMaps (`JENKINS_DB_HOST`)

---

## Phase 1 — Provision infrastructure

**Option A — Ansible**

```bash
cd ansible
cp inventory/hosts.yml.example inventory/hosts.yml
cp group_vars/all.yml.example group_vars/all.yml
# edit IPs and users
ansible-playbook -i inventory/hosts.yml playbooks/site.yml
```

Then finish scanner binary installs printed by the playbooks ([ansible/README.md](../ansible/README.md) §3).

**Option B — Manual**

Follow [ansible/README.md](../ansible/README.md) §5 (same checklist without Ansible).

You need at minimum:

1. Jenkins host with Docker, Node 20, Postgres, scanners, kubectl, argocd CLI  
2. Kubernetes cluster with Argo CD  
3. Network path: Jenkins → Docker Hub, NVD, Hugging Face, SonarQube, Argo CD, Postgres  

---

## Phase 2 — Database

1. Create role + database `jenkins` (see ansible README SQL).  
2. From a clone on the Jenkins host:

```bash
export JENKINS_DB_HOST=127.0.0.1
export JENKINS_DB_PORT=5432
export JENKINS_DB_NAME=jenkins
export JENKINS_DB_USER=jenkins
export JENKINS_DB_PASSWORD='YOUR_PASSWORD'
chmod +x scripts/apply-db-migrations.sh
scripts/apply-db-migrations.sh
```

3. Confirm:

```bash
psql -h 127.0.0.1 -U jenkins -d jenkins -c '\dt'
```

You should see tables such as `security_builds`, `findings`, `dashboard_users`, `ai_analyses`.

4. If Kubernetes pods must reach this Postgres, set `JENKINS_DB_HOST` in ConfigMaps to an IP **reachable from the cluster** (not `127.0.0.1` inside a pod). Lab uses `192.168.10.149`. Open firewall port **5432** carefully (preferably private network only).

---

## Phase 3 — SonarQube

1. Start SonarQube (Docker example in ansible README).  
2. Open `http://<sonar-host>:9000` → create project key **`devsecops-simple-shop`**.  
3. Generate an analysis token.  
4. In Jenkins: install SonarQube Scanner plugin; configure server name **`sonarqube-server`** (exact string used by `withSonarQubeEnv('sonarqube-server')`).  
5. Add credential ID **`sonarqube-token`**.  
6. Ensure scanner CLI path matches `SONAR_SCANNER_HOME` in the Jenkinsfile (`/opt/sonar-scanner-6.2.1.4610-linux-x64` or change the Jenkinsfile).

---

## Phase 4 — Argo CD + Kubernetes apps

1. Install Argo CD into namespace `argocd`.  
2. Expose the server (lab NodePort **30443**).  
3. Save admin password into Jenkins credential **`argocd-admin-password`**.  
4. Point Jenkins `KUBECONFIG` / file `/var/lib/jenkins/.kube/config` at the cluster.  
5. Apply Application CRs (or `argocd app create` equivalents):

```bash
kubectl apply -f k8s/argocd-application.yaml
kubectl apply -f k8s/dashboard/argocd-application.yaml
kubectl apply -f k8s/ai-analyzer/argocd-application.yaml
```

6. Optional but recommended cluster secrets:

```bash
kubectl -n devsecops create secret generic jenkins-db-password --from-literal=password='YOUR_PASSWORD'
kubectl -n devsecops create secret generic huggingface-api-key --from-literal=token='hf_...'
```

7. Sync apps in Argo UI or wait for the Jenkins Deploy stage.

| App | URL after sync |
|-----|----------------|
| Simple Shop | `http://<node-ip>:30081` |
| Dashboard | `http://<node-ip>:30410` |
| AI | `http://<node-ip>:30430/health` |

---

## Phase 5 — Jenkins configuration

Complete **every** item in [JENKINS_SETUP.md](JENKINS_SETUP.md):

- Required plugins  
- Tools on the agent PATH  
- All credential IDs (exact spelling)  
- Pipeline job pointing at this repo’s `Jenkinsfile`  
- Cosign keys ([COSIGN.md](COSIGN.md))  

Also create Hugging Face + DB secrets:

| Credential ID | Type | Value |
|---------------|------|-------|
| `jenkins-db-password` | Secret text | Postgres password for `jenkins` |
| `huggingface-api-key` | Secret text | HF token from https://huggingface.co/settings/tokens |

---

## Phase 6 — Docker Hub

1. Create repositories (or allow auto-create):

   - `sneproject/devsecops-project`  
   - `sneproject/devsecops-dashboard`  
   - `sneproject/devsecops-ai`  

2. Jenkins credential **`dockerhub-credentials`** (username + access token) must be able to push those images.

---

## Phase 7 — First pipeline run

1. Run the Jenkins job.  
2. Watch stages; fix the first failure (usually missing plugin, credential ID typo, or Sonar server name).  
3. After **Start Security Services**, agent logs should show health JSON for `:4200` and `:4300` with database connectivity.  
4. **Store Security Findings** should print `"ok":true`.  
5. **AI Security Analysis** should print `"ok":true` (needs HF token + network to Hugging Face).  

Open the dashboard:

- On Jenkins host: `http://<jenkins-ip>:4100`  
- Or NodePort: `http://<node-ip>:30410`  

Login: **`admin` / `admin`** → change password in Settings.

---

## Phase 8 — Local developer loop (optional)

Without Jenkins, on a machine with Docker:

```bash
cp .env.example .env
# edit secrets
docker compose up -d
# or
export JENKINS_DB_PASSWORD=jenkins
export HUGGINGFACE_API_KEY=hf_...
scripts/ensure-security-services.sh
```

Seed a demo build (optional): `scripts/seed-demo-ingest.sh` if present.

Dashboard API: `http://127.0.0.1:4100` — default login `admin` / `admin`.

---

## Troubleshooting (most common)

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `curl: (7) Failed to connect to 127.0.0.1 port 4200` | Ingest not running on agent | Pipeline runs `scripts/ensure-ingest.sh`; check Postgres password credential; `curl http://127.0.0.1:4200/health` |
| Same on port **4300** | AI not running | `scripts/ensure-ai.sh`; need Node + `HUGGINGFACE_API_KEY` |
| Sonar stage fails | Wrong server name / scanner path / token | Jenkins Sonar install must be named `sonarqube-server`; `docker start sonarqube` |
| Argo sync failed | Wrong `repoURL`, auth, or kubeconfig | Fix Application YAML; test `argocd login` + `kubectl get ns` as jenkins |
| Dashboard empty | No successful Store Findings | Re-run pipeline; check ingest `"database":true` |
| Pods CrashLoop DB errors | ConfigMap still points at wrong DB host | Set reachable `JENKINS_DB_HOST` + password secret |
| Global `INGEST_URL` to LAN IP | Stale Jenkins env | Remove it; pipeline forces `http://127.0.0.1:4200/ingest/build` |

---

## Success criteria

- [ ] Jenkins build finishes blue/green  
- [ ] Shop responds on NodePort **30081**  
- [ ] Argo apps `devsecops-simple-shop`, `devsecops-dashboard`, `devsecops-ai-analyzer` Healthy/Synced  
- [ ] Dashboard login works; build number appears under Pipelines  
- [ ] Findings list populated; AI panel shows an analysis  
- [ ] Cosign signature present on Docker Hub image (optional verify with public key)  

You now have a reusable DevSecOps reference lab. Adapt IPs, image names, and secrets for your own organization.
