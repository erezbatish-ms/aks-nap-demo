// Log Analytics Workspace for Container Insights

@description('Name of the Log Analytics workspace')
param name string

@description('Location for the workspace')
param location string

@description('Tags to apply to the workspace')
param tags object = {}

// ============================================================================
// LOG ANALYTICS WORKSPACE
// ============================================================================

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30  // Minimum retention for demo
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    workspaceCapping: {
      dailyQuotaGb: 1  // Limit daily ingestion for cost control
    }
  }
}

// ============================================================================
// OUTPUTS
// ============================================================================

output workspaceId string = logAnalytics.id
output workspaceName string = logAnalytics.name
output customerId string = logAnalytics.properties.customerId
