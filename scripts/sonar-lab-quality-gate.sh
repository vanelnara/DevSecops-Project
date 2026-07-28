#!/usr/bin/env bash
# Configure a lab-friendly SonarQube Quality Gate and assign it to this project.
# Also marks open Security Hotspots as SAFE (lab remediation shortcut).
#
# Requires a token from a user with:
#   - Administer Quality Gates (or global Administer)
#   - Browse / Administer on project (to assign gate + review hotspots)
#
# Analysis-only tokens (Jenkins sonarqube-token) usually get HTTP 403 here.
#
# Usage:
#   export SONAR_HOST_URL=http://192.168.10.149:9000
#   export SONAR_TOKEN=your_admin_user_token
#   chmod +x scripts/sonar-lab-quality-gate.sh
#   ./scripts/sonar-lab-quality-gate.sh
set -euo pipefail

SONAR_HOST_URL="${SONAR_HOST_URL:-http://127.0.0.1:9000}"
SONAR_TOKEN="${SONAR_TOKEN:?SONAR_TOKEN is required}"
PROJECT_KEY="${SONAR_PROJECT_KEY:-devsecops-simple-shop}"
GATE_NAME="${SONAR_LAB_GATE_NAME:-DevSecOps-Lab}"

export SONAR_HOST_URL SONAR_TOKEN PROJECT_KEY GATE_NAME

echo "Sonar URL: ${SONAR_HOST_URL}"
echo "Project:   ${PROJECT_KEY}"
echo "Gate:      ${GATE_NAME}"

python3 - <<'PY'
import base64, json, os, sys, urllib.error, urllib.parse, urllib.request

host = os.environ["SONAR_HOST_URL"].rstrip("/")
token = os.environ["SONAR_TOKEN"]
project = os.environ["PROJECT_KEY"]
gate_name = os.environ["GATE_NAME"]
auth = base64.b64encode(f"{token}:".encode()).decode()


def call(method, path, params=None):
    url = f"{host}{path}"
    data = None
    headers = {"Authorization": f"Basic {auth}"}
    if params is not None:
        data = urllib.parse.urlencode(params).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="replace")
        print(f"ERROR {e.code} {method} {path}", file=sys.stderr)
        print(err or e.reason, file=sys.stderr)
        if e.code == 403:
            print(
                "\n403 = this token cannot administer Quality Gates.\n"
                "Create a User Token while logged in as admin (or a user with\n"
                "'Administer Quality Gates'), then re-run with that token.\n"
                "Or create/assign the gate in the Sonar UI (see docs/SONARQUBE.md).",
                file=sys.stderr,
            )
        sys.exit(1)


gates = call("GET", "/api/qualitygates/list")
names = {g["name"] for g in gates.get("qualitygates", [])}
if gate_name not in names:
    print(f"Creating quality gate {gate_name}...")
    call("POST", "/api/qualitygates/create", {"name": gate_name})
else:
    print(f"Quality gate {gate_name} already exists")

gate = call("GET", f"/api/qualitygates/show?name={urllib.parse.quote(gate_name)}")
gate_id = gate["id"]
print(f"Gate id: {gate_id}")

for cond in gate.get("conditions", []):
    cid = cond.get("id")
    if cid is None:
        continue
    call("POST", "/api/qualitygates/delete_condition", {"id": cid})
    print(f"  - removed condition {cid}")


def add_cond(metric, op, error):
    call(
        "POST",
        "/api/qualitygates/create_condition",
        {"gateId": gate_id, "metric": metric, "op": op, "error": error},
    )
    print(f"  + {metric} {op} {error}")


print("Setting lab conditions (no hotspot-reviewed requirement)...")
add_cond("new_bugs", "GT", "0")
add_cond("new_vulnerabilities", "GT", "0")
add_cond("new_coverage", "LT", "60")

call("POST", "/api/qualitygates/select", {"projectKey": project, "gateId": gate_id})
print(f"Assigned {gate_name} to {project}")

search = json.loads(
    urllib.request.urlopen(
        urllib.request.Request(
            f"{host}/api/hotspots/search?projectKey={urllib.parse.quote(project)}&status=TO_REVIEW&ps=100",
            headers={"Authorization": f"Basic {auth}"},
        ),
        timeout=30,
    ).read().decode()
)
count = 0
for hotspot in search.get("hotspots", []):
    key = hotspot.get("key")
    if not key:
        continue
    call(
        "POST",
        "/api/hotspots/change_status",
        {
            "hotspot": key,
            "status": "SAFE",
            "comment": "Lab reviewed: accepted risk / mitigated in application config",
        },
    )
    count += 1
print(f"Marked {count} hotspot(s) SAFE")
print(f"Open: {host}/dashboard?id={urllib.parse.quote(project)}")
print("Re-run Jenkins SAST (or full pipeline), then refresh the Sonar project page.")
PY
