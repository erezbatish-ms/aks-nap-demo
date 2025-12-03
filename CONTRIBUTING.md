# Contributing to AKS NAP Demo

Thank you for your interest in contributing to the AKS Node Auto-Provisioning Demo!

## Code of Conduct

This project follows the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).

## Reporting Issues

1. Check [existing issues](https://github.com/erezvol/aks-nap-demo/issues) first
2. Include: description, steps to reproduce, environment details, logs

## Development Setup

### Prerequisites
- Azure CLI v2.50+, azd v1.5+, kubectl v1.28+, kubelogin
- Go 1.21+ (dashboard), Python 3.11+ (workload)
- Docker (optional, for local builds)

### Local Development
1. Fork and clone: `git clone https://github.com/YOUR_USERNAME/aks-nap-demo.git`
2. Create branch: `git checkout -b feature/your-feature`
3. Run linting:
   ```bash
   cd src/dashboard && gofmt -w . && go vet ./...
   cd src/workload && pip install flake8 && flake8 .
   ```

## Pull Request Process

1. Create PR against `main` branch
2. Ensure CI passes (all checks green)
3. Request review from maintainers
4. Keep PRs focused and small

## Project Structure

```
aks-nap-demo/
 infra/           # Bicep IaC templates
 src/
    dashboard/   # Go dashboard application
    workload/    # Python CPU stress workload
 k8s/             # Kubernetes manifests
 hooks/           # azd lifecycle hooks
```

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
