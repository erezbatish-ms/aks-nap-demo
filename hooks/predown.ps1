# Pre-down hook for AKS NAP Demo (PowerShell version)
# This script runs before 'azd down' to clean up Kubernetes resources

$ErrorActionPreference = "Continue"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "AKS NAP Demo - Cleanup" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Get outputs from azd environment
Write-Host "`n📋 Retrieving deployment outputs..." -ForegroundColor Yellow
try {
    $envValues = azd env get-values 2>$null | ConvertFrom-StringData
    $AKS_CLUSTER_NAME = $envValues.AZURE_AKS_CLUSTER_NAME -replace '"', ''
    $RESOURCE_GROUP = $envValues.AZURE_RESOURCE_GROUP -replace '"', ''
}
catch {
    Write-Host "⚠️ No active deployment found. Skipping cleanup." -ForegroundColor Yellow
    exit 0
}

if (-not $AKS_CLUSTER_NAME -or -not $RESOURCE_GROUP) {
    Write-Host "⚠️ No active deployment found. Skipping cleanup." -ForegroundColor Yellow
    exit 0
}

Write-Host "  AKS Cluster: $AKS_CLUSTER_NAME"
Write-Host "  Resource Group: $RESOURCE_GROUP"

# Get AKS credentials (if cluster exists)
Write-Host "`n🔑 Getting AKS credentials..." -ForegroundColor Yellow
try {
    az aks get-credentials `
        --resource-group $RESOURCE_GROUP `
        --name $AKS_CLUSTER_NAME `
        --overwrite-existing 2>$null
}
catch {
    Write-Host "⚠️ Could not get cluster credentials. Cluster may already be deleted." -ForegroundColor Yellow
    exit 0
}

# Scale down workload to trigger NAP consolidation
Write-Host "`n📉 Scaling down workload to trigger NAP node consolidation..." -ForegroundColor Yellow
kubectl scale deployment cpu-stress -n nap-demo --replicas=0 2>$null

# Wait for NAP to consolidate nodes
Write-Host "⏳ Waiting for NAP to remove unused nodes (60 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 60

# Delete Kubernetes resources
Write-Host "`n🗑️ Deleting Kubernetes resources..." -ForegroundColor Yellow

# Delete workloads
kubectl delete deployment cpu-stress -n nap-demo --ignore-not-found 2>$null
kubectl delete deployment nap-dashboard -n nap-demo --ignore-not-found 2>$null

# Delete services
kubectl delete service cpu-stress -n nap-demo --ignore-not-found 2>$null
kubectl delete service nap-dashboard -n nap-demo --ignore-not-found 2>$null

# Delete HPA
kubectl delete hpa cpu-stress-hpa -n nap-demo --ignore-not-found 2>$null

# Delete NodePool (will trigger remaining NAP nodes to drain)
kubectl delete nodepool nap-demo-pool --ignore-not-found 2>$null

# Wait for NAP nodes to be removed
Write-Host "⏳ Waiting for NAP nodes to drain (30 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

# Delete namespace
kubectl delete namespace nap-demo --ignore-not-found 2>$null

Write-Host "`n==========================================" -ForegroundColor Green
Write-Host "✅ Cleanup Complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "The NAP-provisioned nodes should be draining."
Write-Host "Azure resources will be deleted by 'azd down'."
Write-Host ""
