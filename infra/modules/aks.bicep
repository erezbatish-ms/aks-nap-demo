// AKS Cluster with Node Auto-Provisioning (NAP) enabled
// Requires: Azure CNI Overlay + Cilium dataplane
// NAP requires preview API version 2024-09-02-preview or later

@description('Name of the AKS cluster')
param name string

@description('Location for the AKS cluster')
param location string

@description('Tags to apply to the cluster')
param tags object = {}

@description('Kubernetes version (empty = latest GA)')
param kubernetesVersion string = ''

@description('VM size for system node pool')
param systemNodeVmSize string = 'Standard_D4s_v5'

@description('Number of nodes in system pool')
param systemNodeCount int = 2

@description('Log Analytics workspace ID for Container Insights')
param logAnalyticsWorkspaceId string

@description('User-assigned managed identity resource ID')
param userAssignedIdentityId string

// ============================================================================
// AKS CLUSTER WITH NAP
// ============================================================================

// Using preview API for Node Auto-Provisioning support
resource aksCluster 'Microsoft.ContainerService/managedClusters@2024-09-02-preview' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${userAssignedIdentityId}': {}
    }
  }
  properties: {
    // Kubernetes version - empty string gets latest GA
    kubernetesVersion: kubernetesVersion == '' ? null : kubernetesVersion
    dnsPrefix: '${name}-dns'
    
    // =========================================================================
    // NODE AUTO-PROVISIONING (NAP) - Key configuration
    // =========================================================================
    nodeProvisioningProfile: {
      mode: 'Auto'  // Enables NAP (Karpenter-based auto-provisioning)
    }
    
    // =========================================================================
    // NETWORK CONFIGURATION - Required for NAP
    // =========================================================================
    networkProfile: {
      networkPlugin: 'azure'
      networkPluginMode: 'overlay'     // Required for NAP
      networkDataplane: 'cilium'        // Required for NAP
      networkPolicy: 'cilium'
      loadBalancerSku: 'standard'       // Required for NAP
      serviceCidr: '10.0.0.0/16'
      dnsServiceIP: '10.0.0.10'
    }
    
    // =========================================================================
    // ENTRA ID AUTHENTICATION - Required (NAP doesn't support Service Principals)
    // =========================================================================
    aadProfile: {
      managed: true
      enableAzureRBAC: true
    }
    
    // =========================================================================
    // SYSTEM NODE POOL - Runs system pods and dashboard
    // =========================================================================
    agentPoolProfiles: [
      {
        name: 'system'
        count: systemNodeCount
        vmSize: systemNodeVmSize
        osType: 'Linux'
        osSKU: 'AzureLinux'
        mode: 'System'
        enableAutoScaling: false  // NAP handles scaling
        vnetSubnetID: null        // Uses default VNet
        maxPods: 110
        type: 'VirtualMachineScaleSets'
        nodeTaints: [
          'CriticalAddonsOnly=true:NoSchedule'  // Reserve for system pods
        ]
      }
    ]
    
    // =========================================================================
    // WORKLOAD IDENTITY - For secure pod authentication
    // =========================================================================
    oidcIssuerProfile: {
      enabled: true
    }
    securityProfile: {
      workloadIdentity: {
        enabled: true
      }
    }
    
    // =========================================================================
    // MONITORING - Container Insights
    // =========================================================================
    addonProfiles: {
      omsagent: {
        enabled: true
        config: {
          logAnalyticsWorkspaceResourceID: logAnalyticsWorkspaceId
        }
      }
    }
    
    // =========================================================================
    // ADDITIONAL SETTINGS
    // =========================================================================
    enableRBAC: true
    disableLocalAccounts: false  // Allow kubectl access
    
    autoUpgradeProfile: {
      upgradeChannel: 'stable'
      nodeOSUpgradeChannel: 'NodeImage'
    }
    
    storageProfile: {
      diskCSIDriver: {
        enabled: true
      }
      fileCSIDriver: {
        enabled: true
      }
      snapshotController: {
        enabled: true
      }
    }
  }
}

// ============================================================================
// OUTPUTS
// ============================================================================

output name string = aksCluster.name
output id string = aksCluster.id
output fqdn string = aksCluster.properties.fqdn
output oidcIssuerUrl string = aksCluster.properties.oidcIssuerProfile.issuerURL
output kubeletIdentityObjectId string = aksCluster.properties.identityProfile.kubeletidentity.objectId
