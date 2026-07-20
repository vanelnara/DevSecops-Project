pipeline {
    agent any

    environment {
        APP_NAME           = 'devsecops-project'
        DOCKER_IMAGE       = 'sneproject/devsecops-project'
        DOCKER_TAG         = "${env.BUILD_NUMBER}"
        SONAR_HOST         = 'http://192.168.10.149:9000'
        SONAR_PROJECT_KEY  = 'devsecops-simple-shop'
        SONAR_SCANNER_HOME = '/opt/sonar-scanner-6.2.1.4610-linux-x64'
        PATH               = "${env.SONAR_SCANNER_HOME}/bin:/usr/local/bin:/usr/bin:/bin:${env.PATH}"
        KUBE_NAMESPACE     = 'devsecops'
        APP_NODEPORT       = '30081'
        ARGOCD_SERVER      = '192.168.10.149:30080'
        ARGOCD_APP_NAME    = 'devsecops-simple-shop'
        REPORTS_DIR        = 'reports'
        GIT_REPO           = 'https://github.com/vanelnara/DevSecops-Project.git'
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '20'))
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
                    runLoggedStage('SAST', 'SonarQube analysis') {
                        dir('microservice') {
                            withSonarQubeEnv('sonarqube-server') {
                                sh """
                                    sonar-scanner \
                                      -Dsonar.projectKey=${SONAR_PROJECT_KEY} \
                                      -Dproject.settings=sonar-project.properties
                                """
                            }
                        }
                        logToPostgres('SAST', 'SUCCESS', 'SonarQube scan completed')
                    }
                }
            }
        }

        stage('Dependency Scan - OWASP') {
            steps {
                script {
                    runLoggedStage('Dependency Scan', 'OWASP Dependency-Check') {
                        dependencyCheck additionalArguments: '''
                            --scan microservice
                            --format ALL
                            --out reports/dependency-check
                            --suppression security/dependency-check-suppressions.xml
                        ''', odcInstallation: 'owasp-dependency-check'
                        dependencyCheckPublisher pattern: 'reports/dependency-check/dependency-check-report.xml'
                        logToPostgres('Dependency Scan', 'SUCCESS', 'Dependency check report published')
                    }
                }
            }
        }

        stage('Secret Detection - Gitleaks') {
            steps {
                script {
                    runLoggedStage('Gitleaks', 'Scanning for secrets') {
                        sh '''
                            mkdir -p reports/gitleaks
                            gitleaks detect \
                              --source . \
                              --config security/gitleaks.toml \
                              --report-path reports/gitleaks/report.json \
                              --report-format json \
                              --exit-code 1 || true
                        '''
                        archiveArtifacts artifacts: 'reports/gitleaks/*.json', allowEmptyArchive: true
                        logToPostgres('Gitleaks', 'SUCCESS', 'Gitleaks scan completed')
                    }
                }
            }
        }

        stage('Docker Build & Push') {
            steps {
                script {
                    runLoggedStage('Docker Build', "Building ${env.DOCKER_IMAGE}:${env.DOCKER_TAG}") {
                        dir('microservice') {
                            docker.withRegistry('https://index.docker.io/v1/', 'dockerhub-credentials') {
                                def img = docker.build("${DOCKER_IMAGE}:${DOCKER_TAG}")
                                img.push()
                                img.push('latest')
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
                        withCredentials([file(credentialsId: 'cosign-private-key', variable: 'COSIGN_KEY')]) {
                            sh """
                                export COSIGN_PASSWORD="\${COSIGN_PASSWORD:-}"
                                cosign sign --key \${COSIGN_KEY} \
                                  -y ${DOCKER_IMAGE}:${DOCKER_TAG}
                            """
                        }
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
                            sh """
                                set -e
                                export KUBECONFIG=/etc/kubernetes/admin.conf

                                kubectl apply -f k8s/namespace.yaml
                                kubectl apply -f k8s/argocd-application.yaml

                                mkdir -p .deploy/k8s
                                cp k8s/namespace.yaml k8s/service.yaml .deploy/k8s/
                                sed "s|sneproject/devsecops-project:latest|${DOCKER_IMAGE}:${DOCKER_TAG}|g" \\
                                  k8s/deployment.yaml > .deploy/k8s/deployment.yaml

                                kubectl apply -f .deploy/k8s/

                                if command -v argocd >/dev/null 2>&1; then
                                  argocd login "${ARGOCD_SERVER}" \\
                                    --username admin \\
                                    --password "\${ARGOCD_PASS}" \\
                                    --insecure \\
                                    --grpc-web
                                  argocd app sync "${ARGOCD_APP_NAME}" --force --timeout 300 || true
                                  argocd app wait "${ARGOCD_APP_NAME}" --health --timeout 300 || true
                                else
                                  kubectl annotate application "${ARGOCD_APP_NAME}" -n argocd \\
                                    argocd.argoproj.io/refresh=hard --overwrite || true
                                fi

                                kubectl rollout status deployment/simple-shop \\
                                  -n "${KUBE_NAMESPACE}" --timeout=180s
                                kubectl get pods -n "${KUBE_NAMESPACE}" -o wide
                            """
                        }
                        logToPostgres('K8s Deploy', 'SUCCESS', "Deployed to namespace ${KUBE_NAMESPACE}")
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
