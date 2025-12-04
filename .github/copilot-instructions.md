# Copilot Instructions for AKS NAP Demo

This repository demonstrates Azure Kubernetes Service (AKS) Node Auto-Provisioning (NAP) powered by Karpenter.

## Project Overview

AKS NAP Demo showcases automatic node provisioning and deprovisioning based on workload demands, featuring:
- Real-time dashboard for monitoring NAP decisions
- CPU stress workload for triggering scaling events
- Karpenter NodePool configuration for VM selection
- Azure infrastructure provisioned via Bicep

## Project Structure

```
aks-nap-demo/
├── infra/              # Bicep IaC templates for Azure resources
│   ├── main.bicep      # Main deployment template
│   └── modules/        # Reusable Bicep modules (AKS, ACR, etc.)
├── src/
│   ├── dashboard/      # Go real-time dashboard application
│   └── workload/       # Python CPU stress workload
├── k8s/                # Kubernetes manifests
│   ├── nodepool.yaml   # Karpenter NodePool CRD
│   ├── namespace.yaml  # Namespace definition
│   ├── dashboard/      # Dashboard deployment manifests
│   └── workload/       # Workload + HPA manifests
├── hooks/              # Azure Developer CLI lifecycle hooks
├── azure.yaml          # Azure Developer CLI configuration
└── README.md           # Project documentation
```

## Technology Stack

### Dashboard (Go)
- **Go version**: 1.21+
- **Framework**: gorilla/mux for HTTP routing, gorilla/websocket for WebSocket
- **Kubernetes client**: client-go for Kubernetes API interactions
- **Location**: `src/dashboard/`

### Workload (Python)
- **Python version**: 3.11+
- **Purpose**: CPU-intensive workload to trigger HPA and NAP scaling
- **Location**: `src/workload/`

### Infrastructure (Bicep)
- **Azure resources**: AKS, ACR, Log Analytics, Managed Identity
- **Location**: `infra/`

### Kubernetes
- **Karpenter NodePool**: Custom resource for NAP configuration
- **HPA**: Horizontal Pod Autoscaler for workload scaling
- **Location**: `k8s/`

## Development Guidelines

### Go Code (Dashboard)
- Format code with `gofmt -w .`
- Run `go vet ./...` for static analysis
- Build with `go build -v ./...`
- Follow standard Go project layout conventions

### Python Code (Workload)
- Use `flake8` for linting
- Follow PEP 8 style guidelines
- Keep the workload simple and CPU-intensive

### Bicep Templates
- Validate with `az bicep build --file infra/main.bicep`
- Use modules for reusable components
- Follow Azure naming conventions with abbreviations from `infra/abbreviations.json`

### Kubernetes Manifests
- Use descriptive annotations
- Include resource requests/limits for all containers
- Follow Karpenter best practices for NodePool configuration

## Build and Test

### Local Development
```bash
# Dashboard
cd src/dashboard
go build -v ./...
go vet ./...
gofmt -l .

# Workload
cd src/workload
pip install flake8
flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics

# Bicep
az bicep build --file infra/main.bicep --stdout > /dev/null
```

### Docker Builds
```bash
docker build -t nap-demo-dashboard:test ./src/dashboard
docker build -t nap-demo-workload:test ./src/workload
```

### CI Pipeline
The repository uses GitHub Actions for CI. See `.github/workflows/ci.yml` for:
- Go linting and building
- Python linting
- Bicep validation
- Docker build tests
- Security scanning with Trivy

## Deployment

Use Azure Developer CLI for deployment:
```bash
azd auth login
az login
azd up
```

**Important**: This demo provisions Azure resources that incur costs. Always run `azd down` when finished.

## Key Concepts

### Node Auto-Provisioning (NAP)
- Powered by Karpenter in AKS
- Automatically provisions nodes based on pending pod requirements
- Consolidates underutilized nodes to optimize costs

### NodePool Configuration
- Located in `k8s/nodepool.yaml`
- Limits VM families to D and E series
- Uses on-demand capacity for consolidation demos
- Immediate consolidation for demo visibility

## Pull Request Guidelines

1. Keep changes focused and small
2. Ensure CI passes (all checks green)
3. Update documentation if needed
4. Test changes locally before submitting
