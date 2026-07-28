# SonarQube setup for this project

## Why the dashboard showed zeros

1. **`sonar.sources=.`** scanned the whole repo (infra, docs, lockfiles) instead of app code.  
2. **No LCOV coverage** was produced — unit tests ran without `c8`, so Coverage stayed **0.0%**.  
3. **SonarQube Community Edition** reports **Bugs**, **Code Smells**, and **Security Hotspots**. The commercial “Vulnerabilities” pack is limited/absent on Community; OWASP/Trivy cover dependency/CVE vulns in this pipeline.

## What the pipeline does now

1. **Unit Tests** → `npm run test:coverage` in `microservice/` → `microservice/coverage/lcov.info`  
2. **SAST - SonarQube** → `sonar-scanner` with `sonar-project.properties`:
   - Sources: `microservice/server`, `security-dashboard/*`, `services/*/src`
   - Tests: `microservice/tests`
   - Coverage: `sonar.javascript.lcov.reportPaths=microservice/coverage/lcov.info`

## SonarQube UI checklist (one-time)

1. Open `http://192.168.10.149:9000`  
2. Project **devsecops-simple-shop** (create if missing).  
3. **Project Settings → General Settings → Languages → JavaScript/TypeScript** — leave defaults.  
4. **Quality Profiles** — use **Sonar way** for JS (and JS Security Hotspots if available).  
5. After the next green Jenkins SAST stage, open **Measures**:
   - **Coverage** should be &gt; 0%  
   - **Lines of code** should count the app JS/JSX  
   - **Issues** may show smells/hotspots (e.g. permissive CORS)  
6. **Security Hotspots** tab — review and set status (To Review → Fixed / Safe).

## Local dry-run

```bash
cd microservice
npm ci
npm run test:coverage
cd ..
sonar-scanner \
  -Dsonar.host.url=http://192.168.10.149:9000 \
  -Dsonar.token=YOUR_TOKEN \
  -Dproject.settings=sonar-project.properties
```

## Remediation workflow

| Source | Where to fix |
|--------|----------------|
| Sonar Bugs / Smells / Hotspots | Application code → new PR → re-run pipeline |
| Dependency CVEs | OWASP / Trivy reports → upgrade packages |
| Secrets | Gitleaks → remove/rotate → `security/gitleaks.toml` |
