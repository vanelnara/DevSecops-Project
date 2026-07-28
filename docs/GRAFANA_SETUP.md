# Grafana + Prometheus monitoring (manual + Ansible + Jenkins)

This lab adds **Grafana Labs** monitoring on top of the existing DevSecOps pipeline:

| Component | Port | Role |
|-----------|------|------|
| **Grafana** | **3030** | Dashboards + email alerts |
| **Prometheus** | **9090** | Metrics store / scrape |
| **Pushgateway** | **9091** | Receives Jenkins build metrics after each pipeline |
| **cAdvisor** | **8081** | Container CPU / RAM on the Jenkins Docker host |
| **node-exporter** (K8s) | NodePort **31000** | Node CPU / RAM on cluster workers |
| **kube-state-metrics** (K8s) | NodePort **31080** | Pod / deployment health |

# Optional: clear stale Pushgateway groups from the old metric scheme (one-time)
# curl -X DELETE http://127.0.0.1:9091/metrics/job/jenkins_pipeline

---

## 1. Manual installation (recommended first time)

### 1.1 On the Jenkins host

```bash
cd /path/to/DevSecops-Project

cp monitoring/.env.example monitoring/.env
# Edit monitoring/.env:
#   GRAFANA_ADMIN_PASSWORD=...
#   GF_SMTP_PASSWORD=<Gmail App Password>   # required for email
#   GRAFANA_ROOT_URL=http://192.168.10.149:3030

docker compose -f monitoring/docker-compose.yml --env-file monitoring/.env up -d

curl -sS http://127.0.0.1:3030/api/health
curl -sS http://127.0.0.1:9090/-/ready
curl -sS http://127.0.0.1:9091/-/healthy
```

Open Grafana: `http://<jenkins-ip>:3030`  
Login: `admin` / value of `GRAFANA_ADMIN_PASSWORD` (default in example: `admin`).

Dashboard folder **DevSecOps** → **DevSecOps overview**.

The overview shows **latest build result** from a *replaceable* Pushgateway snapshot (`devsecops_jenkins_build_status`: `0=SUCCESS`, `1=FAILED`, `2=UNSTABLE`). Older failed builds no longer stick as “latest failed”.

After upgrading metrics, clear legacy groups and recreate Grafana once on the Jenkins host:

```bash
chmod +x scripts/refresh-monitoring.sh
scripts/refresh-monitoring.sh
# Re-run the Jenkins job so the Publish Metrics stage pushes `devsecops_jenkins_*` series.
```

### 1.2 Gmail App Password (email alerts)

1. Sign in to Google as **naravanel31@gmail.com**.  
2. Enable 2FA, then create an [App Password](https://myaccount.google.com/apppasswords).  
3. Put it in `monitoring/.env` as `GF_SMTP_PASSWORD=...` (never commit this file).  
4. Restart Grafana:

```bash
docker compose -f monitoring/docker-compose.yml --env-file monitoring/.env up -d grafana
```

5. In Grafana: **Alerting → Contact points → lab-email** should list `naravanel31@gmail.com`.  
6. Send a test email from the contact point UI.

### 1.3 Jenkins Prometheus plugin (optional but useful)

1. Jenkins → **Manage Jenkins → Plugins** → install **Prometheus metrics**.  
2. Confirm `http://<jenkins-ip>:8080/prometheus` returns metrics.  
3. Prometheus already scrapes `host.docker.internal:8080/prometheus` (see `monitoring/prometheus/prometheus.yml`).

### 1.4 Kubernetes exporters (CPU / RAM for cluster nodes & workloads)

```bash
kubectl apply -k k8s/monitoring/

# Node CPU/RAM
curl -sS http://<any-node-ip>:31000/metrics | head

# Pod / deployment metrics
curl -sS http://<any-node-ip>:31080/metrics | head
```

If the cluster is not on the same host as Docker Prometheus, edit `monitoring/prometheus/prometheus.yml` and replace `host.docker.internal:31000` / `:31080` with your real node IPs, then:

```bash
docker compose -f monitoring/docker-compose.yml --env-file monitoring/.env up -d prometheus
curl -X POST http://127.0.0.1:9090/-/reload
```

---

## 2. Ansible (infrastructure deploy)

From the Ansible control node:

```bash
cd ansible
cp inventory/hosts.yml.example inventory/hosts.yml
cp group_vars/all.yml.example group_vars/all.yml
# set jenkins host IP

ansible-playbook -i inventory/hosts.yml playbooks/04-grafana.yml
# or include via site.yml
```

The playbook copies `monitoring/` to the Jenkins host and starts the compose stack. You still must set `GF_SMTP_PASSWORD` on the host.

---

## 3. Jenkins pipeline integration

After **AI Security Analysis**, the job runs:

1. `scripts/ensure-monitoring.sh` — starts Grafana/Prometheus/Pushgateway if needed  
2. `scripts/publish-metrics-to-grafana.sh` — pushes:

   - `jenkins_pipeline_build_number`  
   - `jenkins_pipeline_failed`  
   - `jenkins_pipeline_duration_seconds`  
   - `jenkins_pipeline_findings_total`  
   - `jenkins_pipeline_risk_score`  

The **post { always }** block publishes again with the final build status (so failures still appear in Grafana).

Optional Jenkins env / credentials:

| Name | Purpose |
|------|---------|
| `GRAFANA_URL` | default `http://127.0.0.1:3030` |
| `PUSHGATEWAY_URL` | default `http://127.0.0.1:9091` |
| `GRAFANA_PASSWORD` | Grafana admin password (default `admin`) |
| Secret text `grafana-smtp-password` | (manual) paste into `monitoring/.env` on the agent |

---

## 4. What you should see after a green build

1. Grafana dashboard **DevSecOps overview** updates build number / duration.  
2. cAdvisor panels show container CPU & memory.  
3. A Grafana annotation marks the build.  
4. If a later build fails, alert **Jenkins pipeline failed** emails **naravanel31@gmail.com**.

---

## 5. Troubleshooting

| Issue | Fix |
|-------|-----|
| Metrics stage fails on Pushgateway | `docker compose -f monitoring/docker-compose.yml --env-file monitoring/.env up -d` |
| No email | Set `GF_SMTP_PASSWORD` App Password; check Google blocks less-secure attempts |
| Empty K8s panels | Apply `k8s/monitoring` and fix scrape IPs in `prometheus.yml` |
| Jenkins scrape down | Install Prometheus plugin; open firewall to `:8080/prometheus` |
| Port 3030 busy | Change `GRAFANA_PORT` in `monitoring/.env` |
