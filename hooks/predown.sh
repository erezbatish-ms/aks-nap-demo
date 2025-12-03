#!/bin/bash
# Pre-down hook for AKS NAP Demo
# This script runs before 'azd down' to clean up Kubernetes resources

set -euo pipefail

echo "=========================================="
echo "AKS NAP Demo - Cleanup"
echo "=========================================="

# Get outputs from azd environment
echo "📋 Retrieving deployment outputs..."
AKS_CLUSTER_NAME=$(azd env get-values | grep AZURE_AKS_CLUSTER_NAME | cut -d'=' -f2 | tr -d '"' || true)
RESOURCE_GROUP=$(azd env get-values | grep AZURE_RESOURCE_GROUP | cut -d'=' -f2 | tr -d '"' || true)

if [ -z "$AKS_CLUSTER_NAME" ] || [ -z "$RESOURCE_GROUP" ]; then
    echo "⚠️ No active deployment found. Skipping cleanup."
    exit 0
fi

echo "  AKS Cluster: $AKS_CLUSTER_NAME"
echo "  Resource Group: $RESOURCE_GROUP"

# Get AKS credentials (if cluster exists)
echo ""
echo "🔑 Getting AKS credentials..."
if ! az aks get-credentials \
    --resource-group "$RESOURCE_GROUP" \
    --name "$AKS_CLUSTER_NAME" \
    --overwrite-existing 2>/dev/null; then
    echo "⚠️ Could not get cluster credentials. Cluster may already be deleted."
    exit 0
fi

# Scale down workload to trigger NAP consolidation
echo ""
echo "📉 Scaling down workload to trigger NAP node consolidation..."
kubectl scale deployment cpu-stress -n nap-demo --replicas=0 2>/dev/null || true

# Wait for NAP to consolidate nodes
echo "⏳ Waiting for NAP to remove unused nodes (60 seconds)..."
sleep 60

# Delete Kubernetes resources
echo ""
echo "🗑️ Deleting Kubernetes resources..."

# Delete workloads
kubectl delete deployment cpu-stress -n nap-demo --ignore-not-found
kubectl delete deployment nap-dashboard -n nap-demo --ignore-not-found

# Delete services
kubectl delete service cpu-stress -n nap-demo --ignore-not-found
kubectl delete service nap-dashboard -n nap-demo --ignore-not-found

# Delete HPA
kubectl delete hpa cpu-stress-hpa -n nap-demo --ignore-not-found

# Delete NodePool (will trigger remaining NAP nodes to drain)
kubectl delete nodepool nap-demo-pool --ignore-not-found

# Wait for NAP nodes to be removed
echo "⏳ Waiting for NAP nodes to drain (30 seconds)..."
sleep 30

# Delete namespace
kubectl delete namespace nap-demo --ignore-not-found

echo ""
echo "=========================================="
echo "✅ Cleanup Complete!"
echo "=========================================="
echo ""
echo "The NAP-provisioned nodes should be draining."
echo "Azure resources will be deleted by 'azd down'."
echo ""
