# Grafana + Prometheus monitoring (manual + Ansible + Jenkins)

This lab adds **Grafana Labs** monitoring on top of the existing DevSecOps pipeline.

| Component | Port | Role | Required? |
|-----------|------|------|-----------|
| **Grafana** | **3030** | Dashboards + email alerts | Yes |
| **Prometheus** | **9090** | Metrics store / scrape | Yes |
| **Pushgateway** | **9091** | Receives Jenkins **pipeline** metrics after each build | Yes |
| **cAdvisor** | **8081** | Container CPU / RAM on the Jenkins Docker host | Yes |
| Jenkins `/prometheus` | **8080** | Extra Jenkins JVM/job metrics | Optional |
| **node-exporter** (K8s) | NodePort **31000** | Node CPU / RAM | Optional |
| **kube-state-metrics** (K8s) | NodePort **31080** | Pod / deployment health | Optional |

**Important:** Pipeline success panels in Grafana come from **Pushgateway** (stage *Publish Metrics to Grafana*), not from the Jenkins `/prometheus` scrape. If Jenkins/K8s targets are DOWN, the overview dashboard still works as long as **pushgateway + cadvisor + prometheus** are UP.

Alert emails go to **`naravanel31@gmail.com`** (Grafana contact point `lab-email`).

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

chmod +x scripts/refresh-monitoring.sh
scripts/refresh-monitoring.sh

curl -sS http://127.0.0.1:3030/api/health
curl -sS http://127.0.0.1:9090/-/ready
curl -sS http://127.0.0.1:9091/-/healthy
```

Open Grafana: `http://<jenkins-ip>:3030`  
Login: `admin` / value of `GRAFANA_ADMIN_PASSWORD` (default in example: `admin`).

Dashboard folder **DevSecOps** → **DevSecOps overview**.

Check Prometheus targets: `http://<jenkins-ip>:9090/targets`  
Expect **UP**: `pushgateway`, `cadvisor`, `prometheus`.

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

---

## 2. Optional scrapes (why you saw DOWN)

### 2.1 Jenkins `403 Forbidden` on `/prometheus`

Prometheus connected to Jenkins, but Jenkins **refused anonymous access**.

Fix on the Jenkins UI:

1. **Manage Jenkins → Plugins** → install **Prometheus metrics** (if missing).  
2. Open `http://127.0.0.1:8080/prometheus` in a browser on the Jenkins host.  
   - If you must log in to see metrics, that is why Prometheus gets **403**.  
3. **Manage Jenkins → Security** (Authorize users):
   - Lab-simple: *Anyone can do anything* (lab only), **or**
   - Grant **Anonymous** permission **Overall/Read** (and Metrics view if listed).  
4. Confirm unauthenticated access:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/prometheus
# expect 200
```

5. Enable the scrape: merge jobs from `monitoring/prometheus/scrape-optional.yml.example` into `monitoring/prometheus/prometheus.yml`, then:

```bash
scripts/refresh-monitoring.sh
```

### 2.2 Kubernetes exporters `connection refused` on `:31000` / `:31080`

Those NodePorts are **not running** until you deploy them:

```bash
kubectl apply -k k8s/monitoring/

curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:31000/metrics
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:31080/metrics
# expect 200
```

Then enable the `k8s-*` jobs from `scrape-optional.yml.example` and refresh monitoring.

Default `prometheus.yml` **does not** scrape Jenkins/K8s anymore, so Prometheus Status → Targets stays clean with 3/3 core UP.

---

## 3. Ansible

```bash
cd ansible
ansible-playbook -i inventory/hosts.yml playbooks/04-grafana.yml
```

Then finish SMTP + optional scrapes on the host (this doc §1–2).

---

## 4. Jenkins pipeline integration

After **AI Security Analysis**, the job runs:

1. `scripts/ensure-monitoring.sh`  
2. `scripts/publish-metrics-to-grafana.sh` → Pushgateway metrics:
   - `devsecops_jenkins_build_number`  
   - `devsecops_jenkins_build_status` (`0=SUCCESS`, `1=FAILED`, `2=UNSTABLE`)  
   - duration / findings / risk  

`post { always }` republishes with the final build status.

---

## 5. What you should see after a green build

1. Prometheus **Targets**: pushgateway, cadvisor, prometheus = **UP**  
2. Grafana **DevSecOps overview**: latest build result + trends  
3. cAdvisor panels: container CPU/memory  
4. Optional: Jenkins/K8s targets UP only after §2  

---

## 6. Troubleshooting

| Issue | Fix |
|-------|-----|
| Only cadvisor UP; jenkins/k8s red | Expected before optional setup — use core-only config (default now) |
| Jenkins 403 | Allow anonymous read of `/prometheus` (§2.1) |
| K8s connection refused | `kubectl apply -k k8s/monitoring/` (§2.2) |
| Pipeline panels empty | Re-run job; confirm Pushgateway has metrics: `curl http://127.0.0.1:9091/metrics \| grep devsecops_jenkins` |
| No email | Set `GF_SMTP_PASSWORD` App Password |
| Stale FAILED badge | `scripts/refresh-monitoring.sh` then re-run pipeline |
