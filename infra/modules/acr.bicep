// Azure Container Registry for storing demo container images

@description('Name of the container registry')
param name string

@description('Location for the registry')
param location string

@description('Tags to apply to the registry')
param tags object = {}

// ============================================================================
// CONTAINER REGISTRY
// ============================================================================

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Basic'  // Basic tier sufficient for demo
  }
  properties: {
    adminUserEnabled: false  // Use managed identity instead
    publicNetworkAccess: 'Enabled'
    policies: {
      retentionPolicy: {
        status: 'disabled'  // No retention policy for demo
      }
    }
  }
}

// ============================================================================
// OUTPUTS
// ============================================================================

output name string = acr.name
output id string = acr.id
output loginServer string = acr.properties.loginServer
