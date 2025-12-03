# Security Policy

## Security Considerations

This demo provisions Azure resources and runs with elevated Kubernetes permissions.

### Azure Resources
- **AKS Cluster**: Azure RBAC enabled
- **Container Registry**: Private ACR with managed identity access
- **Network**: Default VNet with Azure CNI

### Kubernetes RBAC
The dashboard requires cluster-wide read permissions. See `k8s/dashboard/rbac.yaml`.

## Important Warnings

1. **Demo Purpose Only**: Not for production without security review
2. **Public Dashboard**: Exposed via LoadBalancer without authentication
3. **Resource Costs**: Always run `azd down` when finished

## Secrets and Credentials

This repository contains **NO secrets**. All sensitive values are:
- Generated at deployment time
- Stored in Azure (Managed Identities)
- Managed by azd environment variables

### Never Commit
- `.azure/` folder contents
- `.env` files with real values
- `kubeconfig` files
- Subscription IDs, tenant IDs, connection strings

## Reporting Vulnerabilities

**Do NOT** open a public GitHub issue for security vulnerabilities.
Email the maintainer directly with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

## Security Checklist

Before deploying:
- [ ] Review RBAC in `k8s/dashboard/rbac.yaml`
- [ ] Understand NodePool limits in `k8s/nodepool.yaml`
- [ ] Verify `.gitignore` excludes sensitive files
- [ ] Plan cleanup with `azd down` after demo
