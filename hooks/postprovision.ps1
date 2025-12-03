# Post-provision hook for AKS NAP Demo (PowerShell version)
# This script runs after 'azd provision' to deploy Kubernetes resources

$ErrorActionPreference = "Stop"

Write-Host "=========================================="
Write-Host "AKS NAP Demo - Post-Provision Setup"
Write-Host "=========================================="

# Get outputs from azd environment
Write-Host ""
Write-Host "[INFO] Retrieving deployment outputs..."
$envOutput = azd env get-values
$envHash = @{}
foreach ($line in $envOutput) {
    if ($line -match '^([^=]+)=(.*)$') {
        $envHash[$matches[1]] = $matches[2] -replace '^"|"$', ''
    }
}

$AKS_CLUSTER_NAME = $envHash['AZURE_AKS_CLUSTER_NAME']
$RESOURCE_GROUP = $envHash['AZURE_RESOURCE_GROUP']
$ACR_LOGIN_SERVER = $envHash['AZURE_CONTAINER_REGISTRY_ENDPOINT']
$ACR_NAME = $envHash['AZURE_CONTAINER_REGISTRY_NAME']

Write-Host "  AKS Cluster: $AKS_CLUSTER_NAME"
Write-Host "  Resource Group: $RESOURCE_GROUP"
Write-Host "  ACR: $ACR_LOGIN_SERVER"

# Get AKS credentials (admin for initial setup)
Write-Host ""
Write-Host "[INFO] Getting AKS admin credentials..."
az aks get-credentials --resource-group $RESOURCE_GROUP --name $AKS_CLUSTER_NAME --admin --overwrite-existing

# Verify cluster connection
Write-Host ""
Write-Host "[INFO] Verifying cluster connection..."
kubectl cluster-info

# Build and push container images using ACR Tasks (cloud build, no local Docker needed)
Write-Host ""
Write-Host "[INFO] Building and pushing container images using ACR Tasks..."

# Build and push workload image
Write-Host "  Building workload image in cloud..."
az acr build --registry $ACR_NAME --image nap-demo/workload:latest --file src/workload/Dockerfile src/workload

# Build and push dashboard image
Write-Host "  Building dashboard image in cloud..."
az acr build --registry $ACR_NAME --image nap-demo/dashboard:latest --file src/dashboard/Dockerfile src/dashboard

Write-Host "  Images built and pushed successfully"

# Apply Kubernetes manifests
Write-Host ""
Write-Host "[INFO] Applying Kubernetes manifests..."

# Create namespace
Write-Host "  Creating namespace..."
kubectl apply -f k8s/namespace.yaml

# Apply NAP NodePool configuration
Write-Host "  Applying NAP NodePool..."
kubectl apply -f k8s/nodepool.yaml

# Apply workload (with ACR image substitution)
Write-Host "  Applying workload..."
$workloadDeployment = Get-Content k8s/workload/deployment.yaml -Raw
$workloadDeployment = $workloadDeployment -replace '\$\{ACR_LOGIN_SERVER\}', $ACR_LOGIN_SERVER
$workloadDeployment | kubectl apply -f -

kubectl apply -f k8s/workload/hpa.yaml
kubectl apply -f k8s/workload/service.yaml

# Apply dashboard
Write-Host "  Applying dashboard..."
kubectl apply -f k8s/dashboard/rbac.yaml

$dashboardDeployment = Get-Content k8s/dashboard/deployment.yaml -Raw
$dashboardDeployment = $dashboardDeployment -replace '\$\{ACR_LOGIN_SERVER\}', $ACR_LOGIN_SERVER
$dashboardDeployment | kubectl apply -f -

kubectl apply -f k8s/dashboard/service.yaml

# Wait for deployments
Write-Host ""
Write-Host "[INFO] Waiting for deployments to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment/cpu-stress -n nap-demo
kubectl wait --for=condition=available --timeout=300s deployment/nap-dashboard -n nap-demo

# Get dashboard URL
Write-Host ""
Write-Host "[INFO] Getting dashboard URL..."
Write-Host "  Waiting for LoadBalancer IP..."

$DASHBOARD_IP = $null
for ($i = 1; $i -le 30; $i++) {
    $DASHBOARD_IP = kubectl get svc dashboard-service -n nap-demo -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>$null
    if ($DASHBOARD_IP) {
        break
    }
    Start-Sleep -Seconds 10
}

Write-Host ""
Write-Host "=========================================="
Write-Host "Deployment Complete!"
Write-Host "=========================================="
Write-Host ""

if ($DASHBOARD_IP) {
    Write-Host "Dashboard URL: http://$DASHBOARD_IP"
    Write-Host ""
    Write-Host "Open the dashboard in your browser and click Start Demo"
    Write-Host "to see NAP in action!"
} else {
    Write-Host "Dashboard LoadBalancer IP not yet assigned."
    Write-Host "Run: kubectl get svc dashboard-service -n nap-demo"
    Write-Host "to get the external IP once it is ready."
}

Write-Host ""
Write-Host "Useful commands:"
Write-Host "  kubectl get nodes                      - View nodes"
Write-Host "  kubectl get pods -n nap-demo           - View pods"
Write-Host "  kubectl get nodepools -A               - View Karpenter NodePools"
Write-Host "  kubectl get nodeclaims -A              - View NAP NodeClaims"
Write-Host ""
