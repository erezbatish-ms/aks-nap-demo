#!/bin/bash
# Post-provision hook for AKS NAP Demo
# This script runs after 'azd provision' to deploy Kubernetes resources

set -euo pipefail

echo "=========================================="
echo "AKS NAP Demo - Post-Provision Setup"
echo "=========================================="

# Get outputs from azd environment
echo "📋 Retrieving deployment outputs..."
AKS_CLUSTER_NAME=$(azd env get-values | grep AZURE_AKS_CLUSTER_NAME | cut -d'=' -f2 | tr -d '"')
RESOURCE_GROUP=$(azd env get-values | grep AZURE_RESOURCE_GROUP | cut -d'=' -f2 | tr -d '"')
ACR_LOGIN_SERVER=$(azd env get-values | grep AZURE_CONTAINER_REGISTRY_ENDPOINT | cut -d'=' -f2 | tr -d '"')
ACR_NAME=$(azd env get-values | grep AZURE_CONTAINER_REGISTRY_NAME | cut -d'=' -f2 | tr -d '"')

echo "  AKS Cluster: $AKS_CLUSTER_NAME"
echo "  Resource Group: $RESOURCE_GROUP"
echo "  ACR: $ACR_LOGIN_SERVER"

# Get AKS credentials
echo ""
echo "🔑 Getting AKS credentials..."
az aks get-credentials \
    --resource-group "$RESOURCE_GROUP" \
    --name "$AKS_CLUSTER_NAME" \
    --overwrite-existing

# Convert kubeconfig for Entra ID authentication
echo "🔑 Converting kubeconfig for Entra ID..."
kubelogin convert-kubeconfig -l azurecli

# Verify cluster connection
echo ""
echo "🔍 Verifying cluster connection..."
kubectl cluster-info

# Build and push container images using ACR Tasks (cloud build, no local Docker needed)
echo ""
echo "🏗️ Building and pushing container images using ACR Tasks..."

# Build and push workload image
echo "  Building workload image in cloud..."
az acr build --registry "$ACR_NAME" --image nap-demo/workload:latest --file src/workload/Dockerfile src/workload

# Build and push dashboard image
echo "  Building dashboard image in cloud..."
az acr build --registry "$ACR_NAME" --image nap-demo/dashboard:latest --file src/dashboard/Dockerfile src/dashboard

echo "  ✅ Images built and pushed successfully"

# Apply Kubernetes manifests
echo ""
echo "📦 Applying Kubernetes manifests..."

# Create namespace
echo "  Creating namespace..."
kubectl apply -f k8s/namespace.yaml

# Apply NAP NodePool configuration
echo "  Applying NAP NodePool..."
kubectl apply -f k8s/nodepool.yaml

# Apply workload (with ACR image)
echo "  Applying workload..."
export ACR_LOGIN_SERVER
envsubst < k8s/workload/deployment.yaml | kubectl apply -f -
kubectl apply -f k8s/workload/hpa.yaml
kubectl apply -f k8s/workload/service.yaml

# Apply dashboard
echo "  Applying dashboard..."
kubectl apply -f k8s/dashboard/rbac.yaml
envsubst < k8s/dashboard/deployment.yaml | kubectl apply -f -
kubectl apply -f k8s/dashboard/service.yaml

# Wait for deployments
echo ""
echo "Waiting for deployments to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment/cpu-stress -n nap-demo
kubectl wait --for=condition=available --timeout=300s deployment/nap-dashboard -n nap-demo

# Get dashboard URL
echo ""
echo "Getting dashboard URL..."
echo "  Waiting for LoadBalancer IP..."

for i in {1..30}; do
    DASHBOARD_IP=$(kubectl get svc dashboard-service -n nap-demo -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
    if [ -n "$DASHBOARD_IP" ]; then
        break
    fi
    sleep 10
done

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
if [ -n "$DASHBOARD_IP" ]; then
    echo "Dashboard URL: http://${DASHBOARD_IP}"
    echo ""
    echo "Open the dashboard in your browser and click 'Start Demo'"
    echo "to see NAP in action!"
else
    echo "Dashboard LoadBalancer IP not yet assigned."
    echo "Run: kubectl get svc dashboard-service -n nap-demo"
    echo "to get the external IP once it's ready."
fi
echo ""
echo "Useful commands:"
echo "  kubectl get nodes                      - View nodes"
echo "  kubectl get pods -n nap-demo           - View pods"
echo "  kubectl get nodepools -A               - View Karpenter NodePools"
echo "  kubectl get nodeclaims -A              - View NAP NodeClaims"
echo ""
