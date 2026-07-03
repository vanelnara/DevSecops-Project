# Cosign — Image Signing (DevSecOps)

## What is Cosign?

**Cosign** is a tool from [Sigstore](https://docs.sigstore.dev/) that signs and verifies container images using cryptography. In your pipeline it proves:

- The image was built by **your** CI/CD pipeline (not tampered with)
- The image digest matches what was scanned by Trivy
- Kubernetes (or consumers) can **verify** the signature before running the container

## How it works in this project

1. **Docker build** creates `sneproject/devsecops-project:BUILD_NUMBER`
2. **Trivy** scans the image for vulnerabilities
3. **Cosign sign** attaches a digital signature to the image in Docker Hub
4. On deploy, optional **cosign verify** ensures only signed images run

## Key types

| Mode | Use case |
|------|----------|
| **Key pair** (`cosign.key` / `cosign.pub`) | Lab / on-prem — generate once, store in Jenkins credentials |
| **Keyless (OIDC)** | Cloud CI with Sigstore — no key file, uses short-lived certificates |

This project uses a **key pair** stored as Jenkins credential `cosign-private-key`.

## Generate keys (one time, on server2)

```bash
cosign generate-key-pair
# Creates cosign.key (private) and cosign.pub (public)
# Add cosign.key content to Jenkins credential — NEVER commit to Git
```

## Manual sign & verify

```bash
cosign sign --key cosign.key sneproject/devsecops-project:latest
cosign verify --key cosign.pub sneproject/devsecops-project:latest
```

## Why it matters for DevSecOps

Signing closes the gap between **scan** and **deploy**: even if someone pushes a malicious image to your registry, unsigned images can be rejected by policy.
