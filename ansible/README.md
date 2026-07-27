# Ansible — Lab infrastructure for DevSecOps Project

This folder documents **how to put the servers in place** for the Simple Shop DevSecOps pipeline. You can use **Ansible** (recommended for repeatability) or follow the **same steps manually**.

There is no requirement that Ansible run from inside Jenkins. Treat this as **day-0 / day-1 provisioning**. After hosts are ready, continue with [docs/SETUP_GUIDE.md](../docs/SETUP_GUIDE.md) and [docs/JENKINS_SETUP.md](../docs/JENKINS_SETUP.md).

---

## 1. Target architecture (reference lab)

| Host group | Example IP | What runs here |
|------------|------------|----------------|
| `jenkins` | `192.168.10.149` | Jenkins controller (or agent), PostgreSQL, SonarQube (Docker), agent tools (Docker, Node, scanners), kubeconfig for deploy |
| `k8s_control` | (your control plane) | Kubernetes API; Argo CD installed in namespace `argocd` |
| `k8s_workers` | (your workers) | Workloads + NodePorts `30081`, `30410`, `30430`, `30443` |

**Replace IPs** in:

- `ansible/inventory/hosts.yml`
- `Jenkinsfile` → `ARGOCD_SERVER`
- `k8s/sentinelops-config.yaml` and dashboard/AI ConfigMaps → `JENKINS_DB_HOST`
- SonarQube URL in Jenkins system config

---

## 2. Prerequisites on your laptop (Ansible control node)

- Linux, macOS, or WSL with Ansible **2.14+**
- SSH access to target VMs as a sudo-capable user
- Python 3 on targets (Ansible modules)

```bash
# Debian/Ubuntu control node example
sudo apt update
sudo apt install -y ansible sshpass

cd ansible
cp inventory/hosts.yml.example inventory/hosts.yml
cp group_vars/all.yml.example group_vars/all.yml
# edit both files — never commit real passwords
```

Test connectivity:

```bash
ansible all -i inventory/hosts.yml -m ping
```

---

## 3. What gets installed (checklist)

Use this whether you run playbooks or click through a UI.

### 3.1 On the Jenkins host

| Component | Purpose | Typical install |
|-----------|---------|-----------------|
| Java 17+ | Jenkins | distro package or Jenkins package deps |
| Jenkins | CI/CD | [Jenkins Debian/RPM packages](https://www.jenkins.io/doc/book/installing/) |
| Docker Engine + Compose plugin | Build/push images, optional local stack | Docker CE |
| Node.js 20 + npm | Unit tests, ingest, AI, dashboard | NodeSource or distro |
| PostgreSQL 16 | Shared `jenkins` database | Package or Docker `postgres:16-alpine` |
| SonarQube | SAST | Docker image `sonarqube` on port **9000** |
| SonarScanner CLI | Jenkins SAST stage | Unpack to `/opt/sonar-scanner-6.2.1.4610-linux-x64` (matches `Jenkinsfile`) |
| OWASP Dependency-Check CLI | SCA | `/opt/dependency-check/bin/dependency-check.sh` |
| Gitleaks | Secret scan | binary on `PATH` |
| Trivy | Image CVE scan | binary on `PATH` |
| Cosign | Image signing | binary on `PATH` |
| kubectl | Deploy fallback | binary + `/var/lib/jenkins/.kube/config` |
| Argo CD CLI | GitOps sync from pipeline | `argocd` binary on `PATH` |
| curl, git, python3 | Scripts | packages |

Add the `jenkins` OS user to the `docker` group and restart Jenkins after Docker install.

### 3.2 PostgreSQL one-time setup

```sql
CREATE USER jenkins WITH PASSWORD 'CHANGE_ME';
CREATE DATABASE jenkins OWNER jenkins;
GRANT ALL PRIVILEGES ON DATABASE jenkins TO jenkins;
```

Then apply migrations from the repo (as a user who can connect):

```bash
export JENKINS_DB_HOST=127.0.0.1
export JENKINS_DB_PORT=5432
export JENKINS_DB_NAME=jenkins
export JENKINS_DB_USER=jenkins
export JENKINS_DB_PASSWORD='CHANGE_ME'
chmod +x scripts/apply-db-migrations.sh
scripts/apply-db-migrations.sh
```

Migrations:

- `db/migrations/001_security_dashboard.sql` — builds, findings, AI analyses, stages
- `db/migrations/002_dashboard_users.sql` — dashboard users/sessions

### 3.3 SonarQube (Docker example)

```bash
docker run -d --name sonarqube --restart unless-stopped \
  -p 9000:9000 \
  sonarqube:lts-community

# If stopped later:
docker start sonarqube
```

Default first login is often `admin` / `admin` (Sonar forces a password change). Create project key **`devsecops-simple-shop`** and a **user or project analysis token** for Jenkins.

### 3.4 On the Kubernetes cluster

| Component | Notes |
|-----------|--------|
| Namespace `devsecops` | Created by manifests / Argo (`CreateNamespace=true`) |
| Namespace `argocd` | Argo CD install |
| Argo CD | UI/API exposed (this lab: NodePort **30443**) |
| kubeconfig for Jenkins | Readable by Jenkins user at `/var/lib/jenkins/.kube/config` |
| Cluster can pull Docker Hub images | `sneproject/devsecops-*` (or your fork’s images) |

Optional cluster secrets (referenced by deployments when present):

```bash
kubectl -n devsecops create secret generic jenkins-db-password \
  --from-literal=password='CHANGE_ME'

kubectl -n devsecops create secret generic huggingface-api-key \
  --from-literal=token='hf_...'
```

### 3.5 Argo CD applications

Three GitOps apps (source = this GitHub repo, revision `main`):

| App name | Path | Workload | NodePort |
|----------|------|----------|----------|
| `devsecops-simple-shop` | `k8s` | Simple Shop | **30081** |
| `devsecops-dashboard` | `k8s/dashboard` | SentinelOps | **30410** |
| `devsecops-ai-analyzer` | `k8s/ai-analyzer` | AI service | **30430** |

Bootstrap (once Argo CD is up):

```bash
# Get initial admin password
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d; echo

argocd login <ARGOCD_HOST>:30443 --username admin --insecure --grpc-web

# From a clone of this repository:
kubectl apply -f k8s/argocd-application.yaml
kubectl apply -f k8s/dashboard/argocd-application.yaml
kubectl apply -f k8s/ai-analyzer/argocd-application.yaml
```

Update each Application’s `repoURL` if you forked the project.

---

## 4. Running the example playbooks

Playbooks under `playbooks/` are **safe starters**: they install packages and print next manual steps. They do **not** invent your passwords or overwrite kubeconfig.

```bash
cd ansible

# 1) Baseline packages on Jenkins host
ansible-playbook -i inventory/hosts.yml playbooks/01-common.yml

# 2) Agent toolchain hints + directories (Docker, Node, scanners placeholders)
ansible-playbook -i inventory/hosts.yml playbooks/02-jenkins-agent-tools.yml

# 3) PostgreSQL role user reminder + client tools
ansible-playbook -i inventory/hosts.yml playbooks/03-postgres.yml

# 4) Full sequence
ansible-playbook -i inventory/hosts.yml playbooks/site.yml
```

After playbooks succeed, complete **manual** Jenkins UI work in [docs/JENKINS_SETUP.md](../docs/JENKINS_SETUP.md) (plugins, credentials, Sonar scanner installation name `sonarqube-server`).

---

## 5. Manual procedure (no Ansible)

If you prefer not to use Ansible, do this in order:

1. Provision 1+ Linux VMs; note IPs.
2. On Jenkins VM: install Jenkins, Docker, Node 20, Postgres, scanners listed in §3.1.
3. Create Postgres user/db `jenkins` and run migrations (§3.2).
4. Start SonarQube on `:9000` (§3.3); create project + token.
5. Install Kubernetes + Argo CD; expose Argo on a stable host:port (§3.4–3.5).
6. Copy kubeconfig to Jenkins; install `kubectl` + `argocd` CLI.
7. Fork GitHub repo; push your Docker Hub images under your org (update `Jenkinsfile` image names).
8. Follow [docs/JENKINS_SETUP.md](../docs/JENKINS_SETUP.md) for plugins and **exact credential IDs**.
9. Create Pipeline job → run build → open dashboard.

---

## 6. Security notes

- Never commit `inventory/hosts.yml` or `group_vars/all.yml` with real passwords (they are gitignored patterns via `*.yml` secrets in examples only — keep secrets out of git).
- Use `vars/credentials.yml.example` at repo root as a **private checklist**, not as Ansible vault unless you add vault yourself.
- Lab defaults (`admin`/`admin` on the dashboard, compose password `jenkins`) are for learning only.

---

## 7. Verify hosts before first pipeline

On the Jenkins agent:

```bash
java -version
docker version
node -v && npm -v
psql --version || true
curl -sS http://127.0.0.1:5432 || true   # expect failure; proves port concept only
test -x /opt/sonar-scanner-*/bin/sonar-scanner && echo sonar-scanner-ok
command -v gitleaks trivy cosign kubectl argocd
test -r /var/lib/jenkins/.kube/config && echo kubeconfig-ok
docker ps -a | grep -i sonarqube || true
```

When those look healthy, go to [docs/SETUP_GUIDE.md](../docs/SETUP_GUIDE.md).
