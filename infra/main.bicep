// Main Bicep orchestration file for AKS NAP Demo
// Deploys: AKS with NAP, ACR, Log Analytics, and required identities

targetScope = 'subscription'

// ============================================================================
// PARAMETERS
// ============================================================================

@description('Name of the environment (used for resource naming)')
@minLength(1)
@maxLength(20)
param environmentName string

@description('Primary location for all resources')
param location string

@description('Tags to apply to all resources')
param tags object = {}

// Optional parameters with sensible defaults
@description('Kubernetes version (empty = latest GA)')
param kubernetesVersion string = ''

@description('System node pool VM size')
param systemNodeVmSize string = 'Standard_D4s_v5'

@description('System node pool count')
param systemNodeCount int = 2

// ============================================================================
// VARIABLES
// ============================================================================

var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))

// Sanitize environment name for different resource types
var envNameClean = replace(replace(environmentName, '_', ''), '-', '')
var envNameHyphen = replace(environmentName, '_', '-')

// Resource names (following Azure naming conventions)
var resourceGroupName = '${abbrs.resourcesResourceGroups}${envNameHyphen}'
var aksClusterName = '${abbrs.containerServiceManagedClusters}${envNameHyphen}'
var acrName = toLower('${abbrs.containerRegistryRegistries}${envNameClean}${take(resourceToken, 8)}')
var logAnalyticsName = '${abbrs.operationalInsightsWorkspaces}${envNameHyphen}'
var managedIdentityName = '${abbrs.managedIdentityUserAssignedIdentities}${envNameHyphen}'

// Merge default tags with provided tags
var defaultTags = {
  azdEnvName: environmentName
  demo: 'aks-nap'
}
var allTags = union(defaultTags, tags)

// ============================================================================
// RESOURCE GROUP
// ============================================================================

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: resourceGroupName
  location: location
  tags: allTags
}

// ============================================================================
// MODULES
// ============================================================================

// Log Analytics Workspace for Container Insights
module monitoring './modules/monitoring.bicep' = {
  name: 'monitoring'
  scope: rg
  params: {
    name: logAnalyticsName
    location: location
    tags: allTags
  }
}

// Azure Container Registry
module acr './modules/acr.bicep' = {
  name: 'acr'
  scope: rg
  params: {
    name: acrName
    location: location
    tags: allTags
  }
}

// User-assigned Managed Identity for AKS
module identity './modules/identity.bicep' = {
  name: 'identity'
  scope: rg
  params: {
    name: managedIdentityName
    location: location
    tags: allTags
  }
}

// AKS Cluster with Node Auto-Provisioning
module aks './modules/aks.bicep' = {
  name: 'aks'
  scope: rg
  params: {
    name: aksClusterName
    location: location
    tags: allTags
    kubernetesVersion: kubernetesVersion
    systemNodeVmSize: systemNodeVmSize
    systemNodeCount: systemNodeCount
    logAnalyticsWorkspaceId: monitoring.outputs.workspaceId
    userAssignedIdentityId: identity.outputs.identityId
  }
}

// Grant AKS pull access to ACR
module acrPullRole './modules/acr-pull-role.bicep' = {
  name: 'acrPullRole'
  scope: rg
  params: {
    acrName: acr.outputs.name
    principalId: aks.outputs.kubeletIdentityObjectId
  }
}

// ============================================================================
// OUTPUTS
// ============================================================================

// Resource Group
output AZURE_RESOURCE_GROUP string = rg.name

// AKS Cluster
output AZURE_AKS_CLUSTER_NAME string = aks.outputs.name
output AZURE_AKS_CLUSTER_FQDN string = aks.outputs.fqdn
output AZURE_AKS_OIDC_ISSUER string = aks.outputs.oidcIssuerUrl

// Container Registry
output AZURE_CONTAINER_REGISTRY_NAME string = acr.outputs.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = acr.outputs.loginServer

// Monitoring
output AZURE_LOG_ANALYTICS_WORKSPACE_ID string = monitoring.outputs.workspaceId

// Identity
output AZURE_MANAGED_IDENTITY_CLIENT_ID string = identity.outputs.clientId
