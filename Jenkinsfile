    stages {
        stage('Checkout') {
            steps {
                script { logToPostgres('Checkout', 'STARTED', 'Cloning repository') }
                git branch: 'main',
                    url: "${GIT_REPO}",
                    credentialsId: 'github-credentials'
                script { logToPostgres('Checkout', 'SUCCESS', "Commit ${env.GIT_COMMIT}") }
                runLoggedStage('Checkout', 'Cloning repository') {
                    git branch: 'main',
                        url: "${GIT_REPO}",
                        credentialsId: 'github-credentials'
                    logToPostgres('Checkout', 'SUCCESS', "Commit ${env.GIT_COMMIT}")
                }
            }
        }
        stage('Unit Tests') {
            steps {
                script { logToPostgres('Unit Tests', 'STARTED', 'Running npm test') }
                dir('microservice') {
                    sh 'npm ci'
                    sh 'npm test'
                runLoggedStage('Unit Tests', 'Running npm test') {
                    dir('microservice') {
                        sh 'npm ci'
                        sh 'npm test'
                    }
                    logToPostgres('Unit Tests', 'SUCCESS', 'All unit tests passed')
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
                              -Dproject.settings=sonar-project.properties
                        '''
                runLoggedStage('SAST', 'SonarQube analysis') {
                    dir('microservice') {
                        withSonarQubeEnv('sonarqube-server') {
                            sh '''
                                sonar-scanner \
                                  -Dsonar.projectKey=${SONAR_PROJECT_KEY} \
                                  -Dproject.settings=sonar-project.properties
                            '''
                        }
                    }
                    logToPostgres('SAST', 'SUCCESS', 'SonarQube scan completed')
                }
                script { logToPostgres('SAST', 'SUCCESS', 'SonarQube scan completed') }
            }
        }
        stage('SonarQube Quality Gate') {
        stage('Dependency Scan — OWASP') {
            steps {
                script { logToPostgres('Quality Gate', 'STARTED', 'Waiting for SonarQube quality gate') }
                timeout(time: 10, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: false
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
                script { logToPostgres('Quality Gate', 'SUCCESS', 'Quality gate evaluated') }
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
        stage('Docker Build & Push') {
            steps {
                script { logToPostgres('Docker Build', 'STARTED', "Building ${DOCKER_IMAGE}:${DOCKER_TAG}") }
                dir('microservice') {
                    script {
                        docker.withRegistry('https://index.docker.io/v1/', 'dockerhub-credentials') {
                            def img = docker.build("${DOCKER_IMAGE}:${DOCKER_TAG}")
                            img.push()
                            img.push('latest')
                runLoggedStage('Docker Build', "Building ${env.DOCKER_IMAGE}:${env.DOCKER_TAG}") {
                    dir('microservice') {
                        script {
                            docker.withRegistry('https://index.docker.io/v1/', 'dockerhub-credentials') {
                                def img = docker.build("${DOCKER_IMAGE}:${DOCKER_TAG}")
                                img.push()
                                img.push('latest')
                            }
                        }
                    }
                    logToPostgres('Docker Build', 'SUCCESS', "Pushed ${DOCKER_IMAGE}:${DOCKER_TAG}")
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
