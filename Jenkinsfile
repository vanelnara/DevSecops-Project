pipeline {
    agent any

    environment {
        APP_NAME           = 'devsecops-project'
        DOCKER_IMAGE       = 'sneproject/devsecops-project'
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
        // Jenkins Credentials (Secret text) — create these IDs in Jenkins UI
        JENKINS_DB_PASSWORD = credentials('jenkins-db-password')
        DEEPSEEK_API_KEY    = credentials('deepseek-api-key')
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
                    runLoggedStage('Docker Build', "Building ${env.DOCKER_IMAGE}:${env.DOCKER_TAG}") {
                        dir('microservice') {
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

                                    docker build --pull \
                                      --tag "${DOCKER_IMAGE}:${DOCKER_TAG}" \
                                      --tag "${DOCKER_IMAGE}:latest" \
                                      .
                                    docker push "${DOCKER_IMAGE}:${DOCKER_TAG}"
                                    docker push "${DOCKER_IMAGE}:latest"
                                '''
                            }
                        }
                        logToPostgres('Docker Build', 'SUCCESS', "Pushed ${DOCKER_IMAGE}:${DOCKER_TAG}")
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
                    runLoggedStage('K8s Deploy', 'Deploying via Argo CD to worker node') {
                        withCredentials([string(credentialsId: 'argocd-admin-password', variable: 'ARGOCD_PASS')]) {
                            sh '''
                                set -eu
                                export KUBECONFIG=/var/lib/jenkins/.kube/config

                                kubectl apply -f k8s/namespace.yaml
                                kubectl apply -f k8s/argocd-application.yaml

                                argocd login "${ARGOCD_SERVER}" \
                                  --username admin \
                                  --password "${ARGOCD_PASS}" \
                                  --insecure \
                                  --grpc-web
                                argocd app set "${ARGOCD_APP_NAME}" \
                                  --kustomize-image \
                                  "${DOCKER_IMAGE}=${DOCKER_IMAGE}:${DOCKER_TAG}"
                                argocd app sync "${ARGOCD_APP_NAME}" \
                                  --prune \
                                  --timeout 300
                                argocd app wait "${ARGOCD_APP_NAME}" \
                                  --sync \
                                  --health \
                                  --timeout 300

                                kubectl rollout status deployment/simple-shop \
                                  -n "${KUBE_NAMESPACE}" --timeout=180s
                                kubectl get pods -n "${KUBE_NAMESPACE}" -o wide
                            '''
                        }
                        logToPostgres('K8s Deploy', 'SUCCESS', "Deployed to namespace ${KUBE_NAMESPACE}")
                    }
                }
            }
        }

        stage('Start Security Services') {
            steps {
                script {
                    runLoggedStage('Start Services', 'Starting ingest, AI analyzer, and dashboard in background') {
                        // Uses pipeline credentials:
                        //   jenkins-db-password  -> JENKINS_DB_PASSWORD
                        //   deepseek-api-key     -> DEEPSEEK_API_KEY
                        sh '''
                            set -eu
                            chmod +x scripts/ensure-security-services.sh \
                                     scripts/publish-to-dashboard.sh \
                                     scripts/trigger-ai-analysis.sh \
                                     scripts/log-to-postgresql.sh

                            export INGEST_PORT="${INGEST_PORT}"
                            export AI_PORT="${AI_PORT}"
                            export DASHBOARD_API_PORT="${DASHBOARD_API_PORT}"
                            export INGEST_URL="${INGEST_URL}"
                            export AI_ANALYZER_URL="${AI_ANALYZER_URL}"
                            export JENKINS_DB_HOST="${JENKINS_DB_HOST:-127.0.0.1}"
                            export JENKINS_DB_PORT="${JENKINS_DB_PORT:-5432}"
                            export JENKINS_DB_NAME="${JENKINS_DB_NAME:-jenkins}"
                            export JENKINS_DB_USER="${JENKINS_DB_USER:-jenkins}"
                            # JENKINS_DB_PASSWORD and DEEPSEEK_API_KEY come from Jenkins credentials()

                            scripts/ensure-security-services.sh
                        '''
                        logToPostgres('Start Services', 'SUCCESS', 'Security services running in background')
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
                    runLoggedStage('AI Analysis', 'Sending stored findings to DeepSeek AI analyzer') {
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
