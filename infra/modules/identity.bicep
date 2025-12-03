// User-assigned Managed Identity for AKS cluster

@description('Name of the managed identity')
param name string

@description('Location for the identity')
param location string

@description('Tags to apply to the identity')
param tags object = {}

// ============================================================================
// MANAGED IDENTITY
// ============================================================================

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: name
  location: location
  tags: tags
}

// ============================================================================
// OUTPUTS
// ============================================================================

output identityId string = identity.id
output clientId string = identity.properties.clientId
output principalId string = identity.properties.principalId
output tenantId string = identity.properties.tenantId
