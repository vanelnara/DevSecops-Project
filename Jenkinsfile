        stage('Docker Build & Push') {
            steps {
                runLoggedStage('Docker Build', "Building ${env.DOCKER_IMAGE}:${env.DOCKER_TAG}") {
                    dir('microservice') {
                        script {
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
                    logToPostgres('Docker Build', 'SUCCESS', "Pushed ${DOCKER_IMAGE}:${DOCKER_TAG}")
                }
            }
        }
        stage('Container Scan — Trivy') {
        stage('Container Scan - Trivy') {
            steps {
                runLoggedStage('Trivy', 'Container vulnerability scan') {
                    sh '''
                        mkdir -p reports/trivy
                        trivy image \
                          --format json \
                          --output reports/trivy/report.json \
                          --severity HIGH,CRITICAL \
                          ${DOCKER_IMAGE}:${DOCKER_TAG}
                    '''
                    archiveArtifacts artifacts: 'reports/trivy/*.json', allowEmptyArchive: true
                    logToPostgres('Trivy', 'SUCCESS', 'Trivy scan completed')
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
        stage('Image Signing — Cosign') {
        stage('Image Signing - Cosign') {
            steps {
                runLoggedStage('Cosign', 'Signing container image') {
                    withCredentials([file(credentialsId: 'cosign-private-key', variable: 'COSIGN_KEY')]) {
                        sh '''
                            export COSIGN_PASSWORD="${COSIGN_PASSWORD:-}"
                            cosign sign --key ${COSIGN_KEY} \
                              -y ${DOCKER_IMAGE}:${DOCKER_TAG}
                        '''
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
                    logToPostgres('Cosign', 'SUCCESS', "Image signed: ${DOCKER_IMAGE}:${DOCKER_TAG}")
                }
            }
        }
        stage('Deploy to Kubernetes') {
            steps {
                runLoggedStage('K8s Deploy', 'Deploying via Argo CD to worker node') {
                    withCredentials([string(credentialsId: 'argocd-admin-password', variable: 'ARGOCD_PASS')]) {
                        sh '''
                            set -e
                            export KUBECONFIG=/etc/kubernetes/admin.conf
                script {
                    runLoggedStage('K8s Deploy', 'Deploying via Argo CD to worker node') {
                        withCredentials([string(credentialsId: 'argocd-admin-password', variable: 'ARGOCD_PASS')]) {
                            sh """
                                set -e
                                export KUBECONFIG=/etc/kubernetes/admin.conf
                            kubectl apply -f k8s/namespace.yaml
                            kubectl apply -f k8s/argocd-application.yaml
                                kubectl apply -f k8s/namespace.yaml
                                kubectl apply -f k8s/argocd-application.yaml
                            mkdir -p .deploy/k8s
                            cp k8s/namespace.yaml k8s/service.yaml .deploy/k8s/
                            sed "s|sneproject/devsecops-project:latest|${DOCKER_IMAGE}:${DOCKER_TAG}|g" \
                              k8s/deployment.yaml > .deploy/k8s/deployment.yaml
                                mkdir -p .deploy/k8s
                                cp k8s/namespace.yaml k8s/service.yaml .deploy/k8s/
                                sed "s|sneproject/devsecops-project:latest|${DOCKER_IMAGE}:${DOCKER_TAG}|g" \\
                                  k8s/deployment.yaml > .deploy/k8s/deployment.yaml
                            kubectl apply -f .deploy/k8s/
                                kubectl apply -f .deploy/k8s/
                            if command -v argocd >/dev/null 2>&1; then
                              argocd login "${ARGOCD_SERVER}" \
                                --username admin \
                                --password "${ARGOCD_PASS}" \
                                --insecure \
                                --grpc-web
                              argocd app sync "${ARGOCD_APP_NAME}" --force --timeout 300 || true
                              argocd app wait "${ARGOCD_APP_NAME}" --health --timeout 300 || true
                            else
                              kubectl annotate application "${ARGOCD_APP_NAME}" -n argocd \
                                argocd.argoproj.io/refresh=hard --overwrite || true
                            fi
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
                            kubectl rollout status deployment/simple-shop \
                              -n "${KUBE_NAMESPACE}" --timeout=180s
                            kubectl get pods -n "${KUBE_NAMESPACE}" -o wide
                        '''
                                kubectl rollout status deployment/simple-shop \\
                                  -n "${KUBE_NAMESPACE}" --timeout=180s
                                kubectl get pods -n "${KUBE_NAMESPACE}" -o wide
                            """
                        }
                        logToPostgres('K8s Deploy', 'SUCCESS', "Deployed to namespace ${KUBE_NAMESPACE}")
                    }
                    logToPostgres('K8s Deploy', 'SUCCESS', "Deployed to namespace ${KUBE_NAMESPACE} — app http://192.168.10.149:${APP_NODEPORT}")
                }
            }
        }

[3 lines collapsed]

        always {
            script {
                logToPostgres('Pipeline', currentBuild.currentResult ?: 'UNKNOWN',
                    "Build ${env.BUILD_NUMBER} finished — ${currentBuild.currentResult}")
                    "Build ${env.BUILD_NUMBER} finished - ${currentBuild.currentResult}")
            }
            archiveArtifacts artifacts: 'reports/**/*', allowEmptyArchive: true
        }

[1 line collapsed]

            echo 'DevSecOps pipeline completed successfully.'
        }
        failure {
            echo 'Pipeline failed — check stage logs and PostgreSQL pipeline_runs table.'
            echo 'Pipeline failed - check stage logs and PostgreSQL pipeline_runs table.'
        }
    }
}

[22 lines collapsed]
