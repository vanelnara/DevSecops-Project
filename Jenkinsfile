pipeline {
    agent any

    environment {
        APP_NAME           = 'devsecops-project'
        DOCKER_IMAGE       = 'sneproject/devsecops-project'
        DOCKER_TAG         = "${env.BUILD_NUMBER}"
        SONAR_HOST         = 'http://127.0.0.1:9000'
        SONAR_PROJECT_KEY  = 'devsecops-simple-shop'
        KUBE_NAMESPACE     = 'devsecops'
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
                script { logToPostgres('Checkout', 'STARTED', 'Cloning repository') }
                git branch: 'main',
                    url: "${GIT_REPO}",
                    credentialsId: 'github-credentials'
                script { logToPostgres('Checkout', 'SUCCESS', "Commit ${env.GIT_COMMIT}") }
            }
        }

        stage('Unit Tests') {
            steps {
                script { logToPostgres('Unit Tests', 'STARTED', 'Running npm test') }
                dir('microservice') {
                    sh 'npm ci'
                    sh 'npm test'
                }
                script { logToPostgres('Unit Tests', 'SUCCESS', 'All unit tests passed') }
            }
        }

        stage('SAST — SonarQube') {
            steps {
                script { logToPostgres('SAST', 'STARTED', 'SonarQube analysis') }
                dir('microservice') {
                    withSonarQubeEnv('sonarqube-server') {
                        sh '''
                            sonar-scanner \
                              -Dsonar.projectKey=${SONAR_PROJECT_KEY} \
                              -Dsonar.sources=server,public/js \
                              -Dsonar.tests=tests \
                              -Dsonar.host.url=${SONAR_HOST}
                        '''
                    }
                }
                script { logToPostgres('SAST', 'SUCCESS', 'SonarQube scan completed') }
            }
        }

        stage('Dependency Scan — OWASP') {
            steps {
                script { logToPostgres('Dependency Scan', 'STARTED', 'OWASP Dependency-Check') }
                dependencyCheck additionalArguments: '''
                    --scan microservice
                    --format ALL
                    --out reports/dependency-check
                    --suppression security/dependency-check-suppressions.xml
                ''', odcInstallation: 'owasp-dependency-check'
                dependencyCheckPublisher pattern: 'reports/dependency-check/dependency-check-report.xml'
                script { logToPostgres('Dependency Scan', 'SUCCESS', 'Dependency check report published') }
            }
        }

        stage('Secret Detection — Gitleaks') {
            steps {
                script { logToPostgres('Gitleaks', 'STARTED', 'Scanning for secrets') }
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
                script { logToPostgres('Gitleaks', 'SUCCESS', 'Gitleaks scan completed') }
            }
        }

        stage('Docker Build & Push') {
            steps {
                script { logToPostgres('Docker Build', 'STARTED', "Building ${DOCKER_IMAGE}:${DOCKER_TAG}") }
                dir('microservice') {
                    script {
                        docker.withRegistry('https://index.docker.io/v1/', 'dockerhub-credentials') {
                            def img = docker.build("${DOCKER_IMAGE}:${DOCKER_TAG}")
                            img.push()
                            img.push('latest')
                        }
                    }
                }
                script { logToPostgres('Docker Build', 'SUCCESS', "Pushed ${DOCKER_IMAGE}:${DOCKER_TAG}") }
            }
        }

        stage('Container Scan — Trivy') {
            steps {
                script { logToPostgres('Trivy', 'STARTED', 'Container vulnerability scan') }
                sh '''
                    mkdir -p reports/trivy
                    trivy image \
                      --format json \
                      --output reports/trivy/report.json \
                      --severity HIGH,CRITICAL \
                      ${DOCKER_IMAGE}:${DOCKER_TAG}
                '''
                archiveArtifacts artifacts: 'reports/trivy/*.json', allowEmptyArchive: true
                script { logToPostgres('Trivy', 'SUCCESS', 'Trivy scan completed') }
            }
        }

        stage('Image Signing — Cosign') {
            steps {
                script { logToPostgres('Cosign', 'STARTED', 'Signing container image') }
                withCredentials([file(credentialsId: 'cosign-private-key', variable: 'COSIGN_KEY')]) {
                    sh '''
                        export COSIGN_PASSWORD="${COSIGN_PASSWORD:-}"
                        cosign sign --key ${COSIGN_KEY} \
                          -y ${DOCKER_IMAGE}:${DOCKER_TAG}
                    '''
                }
                script { logToPostgres('Cosign', 'SUCCESS', "Image signed: ${DOCKER_IMAGE}:${DOCKER_TAG}") }
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                script { logToPostgres('K8s Deploy', 'STARTED', 'Deploying to worker node') }
                sh '''
                    export KUBECONFIG=/etc/kubernetes/admin.conf
                    kubectl apply -f k8s/namespace.yaml
                    sed "s|sneproject/devsecops-project:latest|${DOCKER_IMAGE}:${DOCKER_TAG}|g" \
                      k8s/deployment.yaml | kubectl apply -f -
                    kubectl apply -f k8s/service.yaml
                    kubectl rollout status deployment/simple-shop -n ${KUBE_NAMESPACE} --timeout=180s
                    kubectl get pods -n ${KUBE_NAMESPACE} -o wide
                '''
                script { logToPostgres('K8s Deploy', 'SUCCESS', "Deployed to namespace ${KUBE_NAMESPACE}") }
            }
        }
    }

    post {
        always {
            script {
                logToPostgres('Pipeline', currentBuild.currentResult ?: 'UNKNOWN',
                    "Build ${env.BUILD_NUMBER} finished — ${currentBuild.currentResult}")
            }
            archiveArtifacts artifacts: 'reports/**/*', allowEmptyArchive: true
        }
        success {
            echo 'DevSecOps pipeline completed successfully.'
        }
        failure {
            echo 'Pipeline failed — check stage logs and PostgreSQL pipeline_runs table.'
        }
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
