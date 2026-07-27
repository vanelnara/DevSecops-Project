pipeline {
    agent any

    environment {
        APP_NAME           = 'devsecops-project'
        DOCKER_IMAGE       = 'sneproject/devsecops-project'
        DASHBOARD_IMAGE    = 'sneproject/devsecops-dashboard'
        AI_IMAGE           = 'sneproject/devsecops-ai'
        DOCKER_TAG         = "${env.BUILD_NUMBER}"
        SONAR_PROJECT_KEY  = 'devsecops-simple-shop'
        SONAR_CREDENTIALS_ID = 'sonarqube-token'
        SONAR_SCANNER_HOME = '/opt/sonar-scanner-6.2.1.4610-linux-x64'
        PATH               = "${env.SONAR_SCANNER_HOME}/bin:/usr/local/bin:/usr/bin:/bin:${env.PATH}"
        KUBE_NAMESPACE     = 'devsecops'
        APP_NODEPORT       = '30081'
        ARGOCD_SERVER      = '192.168.10.149:30443'
        ARGOCD_APP_NAME    = 'devsecops-simple-shop'
        REPORTS_DIR        = 'reports'
        GIT_REPO           = 'https://github.com/vanelnara/DevSecops-Project.git'
        // Security dashboard stack (override via Jenkins global env if needed)
        INGEST_URL         = "${env.INGEST_URL ?: 'http://127.0.0.1:4200/ingest/build'}"
        INGEST_TOKEN       = "${env.INGEST_TOKEN ?: ''}"
        AI_ANALYZER_URL    = "${env.AI_ANALYZER_URL ?: 'http://127.0.0.1:4300'}"
        DASHBOARD_API_PORT = "${env.DASHBOARD_API_PORT ?: '4100'}"
        INGEST_PORT        = "${env.INGEST_PORT ?: '4200'}"
        AI_PORT            = "${env.AI_PORT ?: '4300'}"
        AI_PROVIDER        = 'huggingface'
        HUGGINGFACE_MODEL  = "${env.HUGGINGFACE_MODEL ?: 'Qwen/Qwen2.5-7B-Instruct:fastest'}"
        // Jenkins Credentials (Secret text) — create these IDs in Jenkins UI
        JENKINS_DB_PASSWORD  = credentials('jenkins-db-password')
        HUGGINGFACE_API_KEY  = credentials('huggingface-api-key')
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '20'))
        disableConcurrentBuilds()
        timestamps()
        timeout(time: 60, unit: 'MINUTES')
    }

    stages {
        stage('Checkout') {
            steps {
                script {
                    runLoggedStage('Checkout', 'Cloning repository') {
                        git branch: 'main',
                            url: "${GIT_REPO}",
                            credentialsId: 'github-credentials'
                        logToPostgres('Checkout', 'SUCCESS', "Commit ${env.GIT_COMMIT}")
                    }
                }
            }
        }

        stage('Unit Tests') {
            steps {
                script {
                    runLoggedStage('Unit Tests', 'Running npm test') {
                        dir('microservice') {
                            sh '''
                                export PATH=/usr/bin:/usr/local/bin:$PATH
                                node --version
                                npm --version
                                npm ci
                                npm test
                            '''
                        }
                        logToPostgres('Unit Tests', 'SUCCESS', 'All unit tests passed')
                    }
                }
            }
        }

        stage('SAST - SonarQube') {
            steps {
                script {
                    runLoggedStage('SAST', 'SonarQube analysis from repo root') {
                        withSonarQubeEnv('sonarqube-server') {
                            withCredentials([
                                string(
                                    credentialsId: env.SONAR_CREDENTIALS_ID,
                                    variable: 'SONAR_TOKEN'
                                )
                            ]) {
                                sh '''
                                    set -eu

                                    # Fail clearly if SonarQube server is down (common after reboot)
                                    if ! curl --silent --show-error --fail --max-time 10 \
                                      "${SONAR_HOST_URL}/api/system/status" >/tmp/sonar-status.json; then
                                      echo "ERROR: Cannot reach SonarQube at ${SONAR_HOST_URL}"
                                      echo "On node1 check: docker ps -a | grep sonarqube && docker start sonarqube"
                                      exit 2
                                    fi
                                    echo "SonarQube status: $(cat /tmp/sonar-status.json)"

                                    AUTH_VALID="$(curl --silent --show-error --fail \
                                      --user "${SONAR_TOKEN}:" \
                                      "${SONAR_HOST_URL}/api/authentication/validate" |
                                      tr -d '[:space:]')"

                                    if [ "${AUTH_VALID}" != '{"valid":true}' ]; then
                                      echo "ERROR: Jenkins credential 'sonarqube-token' is not a valid SonarQube token."
                                      echo "Replace it with a valid User, Project Analysis, or Global Analysis token."
                                      exit 2
                                    fi

                                    sonar-scanner \
                                      -Dsonar.token="${SONAR_TOKEN}" \
                                      -Dsonar.projectKey="${SONAR_PROJECT_KEY}" \
                                      -Dproject.settings=sonar-project.properties
                                '''
                            }
                        }
                        logToPostgres('SAST', 'SUCCESS', "SonarQube scan completed for ${SONAR_PROJECT_KEY}")
                    }
                }
            }
        }

        stage('Dependency Scan - OWASP') {
            steps {
                script {
                    runLoggedStage('Dependency Scan', 'OWASP Dependency-Check') {
                        withCredentials([
                            string(credentialsId: 'nvd-api-key', variable: 'NVD_API_KEY')
                        ]) {
                            sh '''
                                set -eu

                                NVD_STATUS="$(curl --silent --show-error \
                                  --output /tmp/nvd-api-check.json \
                                  --write-out '%{http_code}' \
                                  --max-time 30 \
                                  --header "apiKey: ${NVD_API_KEY}" \
                                  'https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1')"

                                if [ "${NVD_STATUS}" != "200" ]; then
                                  echo "ERROR: NVD rejected the Jenkins credential 'nvd-api-key' (HTTP ${NVD_STATUS})."
                                  echo "Confirm the NIST activation email, then replace the Jenkins Secret text without spaces or quotes."
                                  exit 2
                                fi

                                mkdir -p reports/dependency-check
                                /opt/dependency-check/bin/dependency-check.sh \
                                  --project "${APP_NAME}" \
                                  --scan microservice \
                                  --format ALL \
                                  --out reports/dependency-check \
                                  --data /var/lib/jenkins/.dependency-check \
                                  --suppression security/dependency-check-suppressions.xml \
                                  --disableYarnAudit \
                                  --disableOssIndex \
                                  --nvdApiKey "${NVD_API_KEY}"
                            '''
                        }
                        dependencyCheckPublisher pattern: 'reports/dependency-check/dependency-check-report.xml'
                        archiveArtifacts artifacts: 'reports/dependency-check/**/*', allowEmptyArchive: true
                        logToPostgres('Dependency Scan', 'SUCCESS', 'Dependency check report published')
                    }
                }
            }
        }

        stage('Secret Detection - Gitleaks') {
            steps {
                script {
                    runLoggedStage('Gitleaks', 'Scanning for secrets') {
                        def gitleaksExit = sh(
                            returnStatus: true,
                            script: '''
                                mkdir -p reports/gitleaks
                                gitleaks detect \
                                  --source . \
                                  --config security/gitleaks.toml \
                                  --report-path reports/gitleaks/report.json \
                                  --report-format json \
                                  --exit-code 1
                            '''
                        )
                        archiveArtifacts artifacts: 'reports/gitleaks/*.json', allowEmptyArchive: true
                        if (gitleaksExit == 1) {
                            logToPostgres('Gitleaks', 'UNSTABLE', 'Potential secrets found; inspect the archived report')
                            unstable('Gitleaks found potential secrets; inspect reports/gitleaks/report.json')
                        } else if (gitleaksExit != 0) {
                            error("Gitleaks failed with exit code ${gitleaksExit}")
                        } else {
                            logToPostgres('Gitleaks', 'SUCCESS', 'No secrets detected')
                        }
                    }
                }
            }
        }

        stage('Docker Build & Push') {
            steps {
                script {
                    runLoggedStage('Docker Build', "Building shop + dashboard + AI images :${env.DOCKER_TAG}") {
                        withCredentials([
                            usernamePassword(
                                credentialsId: 'dockerhub-credentials',
                                usernameVariable: 'DOCKERHUB_USERNAME',
                                passwordVariable: 'DOCKERHUB_PASSWORD'
                            )
                        ]) {
                            sh '''
                                set -eu
                                trap 'docker logout >/dev/null 2>&1 || true' EXIT

                                printf '%s' "${DOCKERHUB_PASSWORD}" |
                                  docker login \
                                    --username "${DOCKERHUB_USERNAME}" \
                                    --password-stdin

                                # 1) Simple Shop app
                                docker build --pull \
                                  --tag "${DOCKER_IMAGE}:${DOCKER_TAG}" \
                                  --tag "${DOCKER_IMAGE}:latest" \
                                  ./microservice
                                docker push "${DOCKER_IMAGE}:${DOCKER_TAG}"
                                docker push "${DOCKER_IMAGE}:latest"

                                # 2) SentinelOps security dashboard (separate app)
                                docker build --pull \
                                  --tag "${DASHBOARD_IMAGE}:${DOCKER_TAG}" \
                                  --tag "${DASHBOARD_IMAGE}:latest" \
                                  ./security-dashboard
                                docker push "${DASHBOARD_IMAGE}:${DOCKER_TAG}"
                                docker push "${DASHBOARD_IMAGE}:latest"

                                # 3) AI analyzer (separate app)
                                docker build --pull \
                                  --tag "${AI_IMAGE}:${DOCKER_TAG}" \
                                  --tag "${AI_IMAGE}:latest" \
                                  ./services/ai-analyzer
                                docker push "${AI_IMAGE}:${DOCKER_TAG}"
                                docker push "${AI_IMAGE}:latest"

                                echo "Pushed:"
                                echo "  ${DOCKER_IMAGE}:${DOCKER_TAG}"
                                echo "  ${DASHBOARD_IMAGE}:${DOCKER_TAG}"
                                echo "  ${AI_IMAGE}:${DOCKER_TAG}"
                            '''
                        }
                        logToPostgres('Docker Build', 'SUCCESS', "Pushed shop+dashboard+AI :${env.DOCKER_TAG}")
                    }
                }
            }
        }

        stage('Container Scan - Trivy') {
            steps {
                script {
                    runLoggedStage('Trivy', 'Container vulnerability scan') {
                        sh """
                            mkdir -p reports/trivy
                            trivy image \
                              --format json \
                              --output reports/trivy/report.json \
                              --severity HIGH,CRITICAL \
                              ${DOCKER_IMAGE}:${DOCKER_TAG}
                        """
                        archiveArtifacts artifacts: 'reports/trivy/*.json', allowEmptyArchive: true
                        logToPostgres('Trivy', 'SUCCESS', 'Trivy scan completed')
                    }
                }
            }
        }

        stage('Image Signing - Cosign') {
            steps {
                script {
                    runLoggedStage('Cosign', 'Signing container image') {
                        withCredentials([
                            file(credentialsId: 'cosign-private-key', variable: 'COSIGN_KEY'),
                            string(credentialsId: 'cosign-password', variable: 'COSIGN_PASSWORD'),
                            usernamePassword(
                                credentialsId: 'dockerhub-credentials',
                                usernameVariable: 'DOCKERHUB_USERNAME',
                                passwordVariable: 'DOCKERHUB_PASSWORD'
                            )
                        ]) {
                            sh '''
                                set -eu
                                trap 'docker logout >/dev/null 2>&1 || true' EXIT

                                printf '%s' "${DOCKERHUB_PASSWORD}" |
                                  docker login \
                                    --username "${DOCKERHUB_USERNAME}" \
                                    --password-stdin

                                mkdir -p .deploy
                                cosign sign \
                                  --key "${COSIGN_KEY}" \
                                  --yes \
                                  "${DOCKER_IMAGE}:${DOCKER_TAG}"
                                cosign public-key \
                                  --key "${COSIGN_KEY}" \
                                  > .deploy/cosign.pub
                                cosign verify \
                                  --key .deploy/cosign.pub \
                                  "${DOCKER_IMAGE}:${DOCKER_TAG}" \
                                  >/dev/null
                            '''
                        }
                        archiveArtifacts artifacts: '.deploy/cosign.pub', allowEmptyArchive: false
                        logToPostgres('Cosign', 'SUCCESS', "Image signed: ${DOCKER_IMAGE}:${DOCKER_TAG}")
                    }
                }
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                script {
                    runLoggedStage('K8s Deploy', 'Deploying shop + dashboard + AI as separate apps') {
                        withCredentials([string(credentialsId: 'argocd-admin-password', variable: 'ARGOCD_PASS')]) {
                            sh '''
                                set -eu
                                export KUBECONFIG=/var/lib/jenkins/.kube/config

                                kubectl apply -f k8s/namespace.yaml
                                kubectl apply -f k8s/sentinelops-config.yaml
                                kubectl apply -f k8s/argocd-application.yaml
                                kubectl apply -f k8s/dashboard/argocd-application.yaml
                                kubectl apply -f k8s/ai-analyzer/argocd-application.yaml

                                argocd login "${ARGOCD_SERVER}" \
                                  --username admin \
                                  --password "${ARGOCD_PASS}" \
                                  --insecure \
                                  --grpc-web

                                # --- App 1: simple-shop ---
                                argocd app set "${ARGOCD_APP_NAME}" \
                                  --kustomize-image \
                                  "${DOCKER_IMAGE}=${DOCKER_IMAGE}:${DOCKER_TAG}"
                                argocd app sync "${ARGOCD_APP_NAME}" \
                                  --prune --force --timeout 300 || true

                                # --- App 2: security-dashboard (separate) ---
                                argocd app set devsecops-dashboard \
                                  --kustomize-image \
                                  "${DASHBOARD_IMAGE}=${DASHBOARD_IMAGE}:${DOCKER_TAG}" || true
                                argocd app sync devsecops-dashboard \
                                  --prune --force --timeout 300 || true

                                # --- App 3: ai-analyzer (separate) ---
                                argocd app set devsecops-ai-analyzer \
                                  --kustomize-image \
                                  "${AI_IMAGE}=${AI_IMAGE}:${DOCKER_TAG}" || true
                                argocd app sync devsecops-ai-analyzer \
                                  --prune --force --timeout 300 || true

                                # Fallback kubectl apply if Argo apps are not ready yet
                                kubectl apply -k k8s
                                kubectl apply -k k8s/dashboard
                                kubectl apply -k k8s/ai-analyzer
                                kubectl -n "${KUBE_NAMESPACE}" set image deployment/simple-shop \
                                  "simple-shop=${DOCKER_IMAGE}:${DOCKER_TAG}" || true
                                kubectl -n "${KUBE_NAMESPACE}" set image deployment/security-dashboard \
                                  "security-dashboard=${DASHBOARD_IMAGE}:${DOCKER_TAG}" || true
                                kubectl -n "${KUBE_NAMESPACE}" set image deployment/ai-analyzer \
                                  "ai-analyzer=${AI_IMAGE}:${DOCKER_TAG}" || true

                                WAIT_OK=0
                                for attempt in 1 2 3 4 5; do
                                  echo "Argo CD wait attempt ${attempt}/5 (simple-shop)..."
                                  if argocd app wait "${ARGOCD_APP_NAME}" \
                                    --sync --health --timeout 90; then
                                    WAIT_OK=1
                                    break
                                  fi
                                  argocd app get "${ARGOCD_APP_NAME}" || true
                                  kubectl get pods,deploy -n "${KUBE_NAMESPACE}" -o wide || true
                                  sleep 10
                                  argocd login "${ARGOCD_SERVER}" \
                                    --username admin \
                                    --password "${ARGOCD_PASS}" \
                                    --insecure --grpc-web || true
                                done

                                if [ "${WAIT_OK}" != "1" ]; then
                                  echo "WARNING: argocd wait incomplete — using kubectl rollout"
                                fi

                                kubectl rollout status deployment/simple-shop -n "${KUBE_NAMESPACE}" --timeout=300s \
                                || {
                                  kubectl describe deployment/simple-shop -n "${KUBE_NAMESPACE}" || true
                                  kubectl get pods -n "${KUBE_NAMESPACE}" -o wide || true
                                  kubectl rollout restart deployment/simple-shop -n "${KUBE_NAMESPACE}" || true
                                  kubectl rollout status deployment/simple-shop -n "${KUBE_NAMESPACE}" --timeout=180s
                                }

                                # Dashboard + AI are separate apps — wait independently (do not fail shop if one is slow)
                                kubectl rollout status deployment/security-dashboard -n "${KUBE_NAMESPACE}" --timeout=180s || true
                                kubectl rollout status deployment/ai-analyzer -n "${KUBE_NAMESPACE}" --timeout=180s || true

                                kubectl get pods,svc -n "${KUBE_NAMESPACE}" -o wide
                                echo "Dashboard NodePort: 30410 | AI NodePort: 30430 | Shop NodePort: 30081"
                            '''
                        }
                        logToPostgres('K8s Deploy', 'SUCCESS', "Deployed shop+dashboard+AI to ${env.KUBE_NAMESPACE}")
                    }
                }
            }
        }

        stage('Start Security Services') {
            steps {
                script {
                    runLoggedStage('Start Services', 'Starting ingest, AI analyzer, and dashboard in background') {
                        // Uses pipeline credentials:
                        //   jenkins-db-password   -> JENKINS_DB_PASSWORD
                        //   huggingface-api-key   -> HUGGINGFACE_API_KEY
                        sh '''
                            set -eu
                            chmod +x scripts/ensure-security-services.sh \
                                     scripts/apply-db-migrations.sh \
                                     scripts/publish-to-dashboard.sh \
                                     scripts/trigger-ai-analysis.sh \
                                     scripts/log-to-postgresql.sh

                            export INGEST_PORT="${INGEST_PORT}"
                            export AI_PORT="${AI_PORT}"
                            export DASHBOARD_API_PORT="${DASHBOARD_API_PORT}"
                            # Host-published ports so Jenkins steps can reach the Docker network services
                            export INGEST_URL="${INGEST_URL:-http://127.0.0.1:${INGEST_PORT}/ingest/build}"
                            export AI_ANALYZER_URL="${AI_ANALYZER_URL:-http://127.0.0.1:${AI_PORT}}"
                            export AI_PROVIDER="${AI_PROVIDER:-huggingface}"
                            export HUGGINGFACE_MODEL="${HUGGINGFACE_MODEL:-Qwen/Qwen2.5-7B-Instruct:fastest}"
                            export JENKINS_DB_HOST="${JENKINS_DB_HOST:-127.0.0.1}"
                            export JENKINS_DB_PORT="${JENKINS_DB_PORT:-5432}"
                            export JENKINS_DB_NAME="${JENKINS_DB_NAME:-jenkins}"
                            export JENKINS_DB_USER="${JENKINS_DB_USER:-jenkins}"
                            # JENKINS_DB_PASSWORD + HUGGINGFACE_API_KEY from Jenkins credentials()
                            # Stack runs in Docker on network devsecops-net (postgres/ingest/ai/dashboard).

                            scripts/ensure-security-services.sh
                            echo "Docker network: devsecops-net"
                            echo "Dashboard: http://127.0.0.1:${DASHBOARD_API_PORT:-4100}/ (admin/admin)"
                            docker compose ps || true
                        '''
                        logToPostgres('Start Services', 'SUCCESS', 'Docker security stack up on devsecops-net')
                    }
                }
            }
        }

        stage('Store Security Findings') {
            steps {
                script {
                    runLoggedStage('Store Findings', 'Uploading scanner reports to PostgreSQL via ingest bridge') {
                        def publishStatus = currentBuild.currentResult ?: 'SUCCESS'
                        withEnv([
                            "STATUS=${publishStatus}",
                            "BRANCH=${env.GIT_BRANCH ?: 'main'}",
                            "COMMIT_SHA=${env.GIT_COMMIT ?: ''}",
                            "IMAGE_TAG=${env.DOCKER_IMAGE}:${env.DOCKER_TAG}",
                            "INGEST_URL=${env.INGEST_URL}",
                            "INGEST_TOKEN=${env.INGEST_TOKEN ?: ''}",
                        ]) {
                            sh '''
                                set -eu
                                chmod +x scripts/publish-to-dashboard.sh
                                export JOB_NAME="${JOB_NAME}"
                                export BUILD_NUMBER="${BUILD_NUMBER}"
                                export REPORTS_DIR="${REPORTS_DIR}"
                                if [ -n "${BUILD_ID:-}" ]; then
                                  START_EPOCH="$(date -d "$(echo "${BUILD_ID}" | tr '_' ' ' | tr '-' ':')" +%s 2>/dev/null || true)"
                                  NOW_EPOCH="$(date +%s)"
                                  if [ -n "${START_EPOCH:-}" ]; then
                                    export DURATION_SECONDS="$((NOW_EPOCH - START_EPOCH))"
                                  fi
                                fi
                                scripts/publish-to-dashboard.sh
                            '''
                        }
                        logToPostgres('Store Findings', 'SUCCESS', "Stored findings for build ${env.BUILD_NUMBER}")
                    }
                }
            }
        }

        stage('AI Security Analysis') {
            steps {
                script {
                    runLoggedStage('AI Analysis', 'Sending stored findings to Hugging Face AI analyzer') {
                        withEnv(["AI_ANALYZER_URL=${env.AI_ANALYZER_URL}"]) {
                            sh '''
                                set -eu
                                chmod +x scripts/trigger-ai-analysis.sh
                                export JOB_NAME="${JOB_NAME}"
                                export BUILD_NUMBER="${BUILD_NUMBER}"
                                scripts/trigger-ai-analysis.sh
                            '''
                        }
                        logToPostgres('AI Analysis', 'SUCCESS', "AI analysis completed for build ${env.BUILD_NUMBER}")
                    }
                }
            }
        }
    }

    post {
        always {
            script {
                logToPostgres('Pipeline', currentBuild.currentResult ?: 'UNKNOWN',
                    "Build ${env.BUILD_NUMBER} finished - ${currentBuild.currentResult}")
            }
            archiveArtifacts artifacts: 'reports/**/*', allowEmptyArchive: true
        }
        success {
            echo 'DevSecOps pipeline completed successfully.'
        }
        failure {
            echo 'Pipeline failed - check stage logs and PostgreSQL pipeline_runs table.'
        }
    }
}

def runLoggedStage(String stageName, String startDetails, Closure body) {
    logToPostgres(stageName, 'STARTED', startDetails)
    try {
        body.call()
    } catch (err) {
        logToPostgres(stageName, 'FAILED', err.message ?: 'Stage failed')
        throw err
    }
}

def logToPostgres(String stageName, String status, String details) {
    sh """
        chmod +x scripts/log-to-postgresql.sh
        scripts/log-to-postgresql.sh \
          '${env.JOB_NAME}' \
          '${env.BUILD_NUMBER}' \
          '${stageName}' \
          '${status}' \
          '${details.replace("'", "'\\''")}'
    """
}
