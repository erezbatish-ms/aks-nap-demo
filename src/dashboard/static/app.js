/**
 * AKS NAP Demo Dashboard - Frontend Application
 * Real-time visualization of Node Auto-Provisioning behavior
 */

// Global state
let ws = null;
let scalingChart = null;
let nodeDistChart = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
let lastMessageTime = Date.now();
let heartbeatInterval = null;
const HEARTBEAT_TIMEOUT_MS = 10000; // Consider connection stale after 10s without messages

// Event explanations for NAP/Karpenter events
const eventExplanations = {
    // Karpenter/NAP Provisioning Events
    'Nominated': 'NAP has selected this node as the best fit for pending pods based on resource requirements.',
    'NominatePod': 'NAP is evaluating this pod for scheduling on a new or existing node.',
    'Provisioning': 'NAP is requesting Azure to create a new VM for this node.',
    'ProvisionedNodeClaim': 'NAP has successfully provisioned a new NodeClaim.',
    'Launched': 'Azure has successfully created the VM and it is starting up.',
    'LaunchedNodeClaim': 'NAP has launched a new node to handle pending pods.',
    'Registered': 'The new node has joined the Kubernetes cluster and is ready to accept pods.',
    'RegisteredNode': 'NAP has registered the new node with the Kubernetes cluster.',
    'Initialized': 'The node has completed initialization and all system pods are running.',
    
    // Karpenter/NAP Disruption Events
    'Consolidating': 'NAP detected underutilized nodes and is moving pods to consolidate workloads.',
    'Unconsolidatable': 'This node cannot be consolidated (e.g., Spot-to-Spot consolidation is disabled).',
    'Disrupting': 'NAP is gracefully evicting pods from this node before termination.',
    'DisruptionTerminating': 'NAP is terminating this node due to underutilization or consolidation.',
    'DisruptionBlocked': 'Node disruption is temporarily blocked (node may be initializing or already deleting).',
    'Drifted': 'Node configuration has drifted from the desired NodePool spec and needs replacement.',
    'Emptied': 'All pods have been evicted from this node, it is ready for termination.',
    'Deleted': 'The node has been removed from the cluster.',
    'Terminating': 'Azure is shutting down and deleting the VM.',
    'FailedDraining': 'NAP failed to drain all pods from the node before termination.',
    
    // VM Events
    'VMEventScheduled': 'Azure VM maintenance or other scheduled event status change.',
    
    // Node Status Transitions
    'Ready': 'Node status condition has changed - kubelet is now posting ready status.',
    'NodeReady': 'The node is healthy and ready to run pods.',
    'NodeNotReady': 'The node has become unresponsive or unhealthy.',
    'NodeHasSufficientMemory': 'Node memory pressure condition has cleared.',
    'NodeHasNoDiskPressure': 'Node disk pressure condition has cleared.',
    'NodeHasSufficientPID': 'Node PID pressure condition has cleared.',
    
    // Pod Scheduling Events
    'Scheduled': 'The Kubernetes scheduler has assigned this pod to run on a specific node.',
    'Binding': 'Kubernetes is binding the pod to its assigned node.',
    'TriggeredScaleUp': 'Pending pods triggered NAP to provision additional node capacity.',
    'NotTriggerScaleUp': 'Pending pods did not trigger scale up (resources available or limits reached).',
    'ScaledUpGroup': 'A node group has been scaled up to add capacity.',
    'FailedScheduling': 'No node has sufficient resources to run this pod.',
    
    // Pod Lifecycle Events
    'Pulling': 'The container runtime is downloading the container image from the registry.',
    'Pulled': 'The container image has been successfully downloaded.',
    'Created': 'The container has been created and is ready to start.',
    'Started': 'The container is now running.',
    'Killing': 'The container is being terminated (graceful shutdown).',
    'Preempted': 'This pod was evicted to make room for a higher-priority pod.',
    
    // Health & Readiness Events
    'Unhealthy': 'A health probe (liveness/readiness) has failed.',
    'ProbeWarning': 'Health probe returned a warning status.',
    'ContainerProbeWarning': 'Container health check detected an issue.',
    
    // Volume/Mount Events
    'FailedMount': 'Failed to mount a volume to the pod.',
    'FailedAttachVolume': 'Failed to attach a persistent volume.',
    'SuccessfulAttachVolume': 'Persistent volume was successfully attached.',
    
    // Image Events
    'BackOff': 'Container is in crash loop, waiting before restart.',
    'Failed': 'An operation has failed (see message for details).',
    'ErrImagePull': 'Failed to pull the container image.',
    'ImagePullBackOff': 'Waiting before retrying failed image pull.'
};

// Get explanation for an event reason
function getEventExplanation(reason) {
    return eventExplanations[reason] || 'Kubernetes cluster event.';
}

// Load cluster info on startup
async function loadClusterInfo() {
    try {
        const response = await fetch('/api/cluster');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const info = await response.json();
        updateClusterInfo(info);
    } catch (error) {
        console.error('Failed to load cluster info:', error);
        document.getElementById('clusterName').textContent = 'Error loading';
    }
}

// Update cluster info UI elements
function updateClusterInfo(info) {
    // Main cluster info
    document.getElementById('clusterName').textContent = info.clusterName || 'Unknown';
    document.getElementById('clusterRegion').textContent = info.region || 'Unknown';
    document.getElementById('k8sVersion').textContent = info.kubernetesVersion || 'Unknown';
    document.getElementById('clusterCNI').textContent = info.cni || info.networkPlugin || 'Unknown';
    document.getElementById('networkPolicy').textContent = info.networkPolicy || 'None';
    document.getElementById('napEnabled').textContent = info.napEnabled ? '✅ Yes' : '❌ No';
    
    // NodePool config
    if (info.nodePoolConfig) {
        const np = info.nodePoolConfig;
        document.getElementById('poolName').textContent = np.name || '-';
        document.getElementById('skuFamilies').textContent = np.skuFamilies?.join(', ') || '-';
        document.getElementById('capacityTypes').textContent = np.capacityTypes?.join(', ') || '-';
        document.getElementById('cpuSizes').textContent = np.cpuSizes?.join(', ') || '-';
        document.getElementById('consolidationPolicy').textContent = np.consolidationPolicy || '-';
        document.getElementById('consolidateAfter').textContent = np.consolidateAfter || '-';
        document.getElementById('cpuLimit').textContent = np.cpuLimit || '-';
        document.getElementById('memoryLimit').textContent = np.memoryLimit || '-';
    }
}

// Setup cluster info toggle
function setupClusterInfoToggle() {
    const toggleBtn = document.getElementById('toggleClusterInfo');
    const content = document.getElementById('clusterInfoContent');
    
    toggleBtn.addEventListener('click', () => {
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'block' : 'none';
        toggleBtn.textContent = isHidden ? '▼' : '▶';
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    connectWebSocket();
    setupEventListeners();
    startHeartbeatMonitor();
    loadClusterInfo();
    setupClusterInfoToggle();
});

// Monitor for stale connections - if no message received in 10s, reconnect
function startHeartbeatMonitor() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        const timeSinceLastMessage = Date.now() - lastMessageTime;
        if (ws && ws.readyState === WebSocket.OPEN && timeSinceLastMessage > HEARTBEAT_TIMEOUT_MS) {
            console.warn('Connection stale (no messages for 10s), reconnecting...');
            ws.close();
            connectWebSocket();
        }
    }, 5000);
}

// Setup button event listeners
function setupEventListeners() {
    document.getElementById('startDemo').addEventListener('click', startDemo);
    document.getElementById('stopDemo').addEventListener('click', stopDemo);
}

// WebSocket connection
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    updateConnectionStatus('connecting');
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        updateConnectionStatus('connected');
        reconnectAttempts = 0;
    };
    
    ws.onmessage = (event) => {
        try {
            lastMessageTime = Date.now(); // Update heartbeat timestamp
            const state = JSON.parse(event.data);
            updateDashboard(state);
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        updateConnectionStatus('disconnected');
        attemptReconnect();
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus('disconnected');
    };
}

function attemptReconnect() {
    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
        setTimeout(connectWebSocket, delay);
    }
}

function updateConnectionStatus(status) {
    const statusEl = document.getElementById('connectionStatus');
    const dot = statusEl.querySelector('.status-dot');
    const text = statusEl.querySelector('.status-text');
    
    dot.className = 'status-dot';
    
    switch (status) {
        case 'connected':
            dot.classList.add('connected');
            text.textContent = 'Connected';
            break;
        case 'connecting':
            text.textContent = 'Connecting...';
            break;
        case 'disconnected':
            dot.classList.add('disconnected');
            text.textContent = 'Disconnected';
            break;
    }
}

// Maximum data points to keep in charts (prevents memory issues)
const MAX_CHART_POINTS = 60;

// Throttle chart updates to prevent performance issues
let lastChartUpdate = 0;
const CHART_UPDATE_INTERVAL = 2000; // Update charts max every 2 seconds

// Initialize Chart.js charts
function initCharts() {
    // Disable animations globally for better performance
    Chart.defaults.animation = false;
    Chart.defaults.animations = { colors: false, x: false };
    Chart.defaults.transitions = { active: { animation: { duration: 0 } } };
    
    // Scaling chart
    const scalingCtx = document.getElementById('scalingChart').getContext('2d');
    scalingChart = new Chart(scalingCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Total Nodes',
                    data: [],
                    borderColor: '#0078d4',
                    backgroundColor: 'rgba(0, 120, 212, 0.1)',
                    fill: false,
                    tension: 0.2,
                    pointRadius: 2,
                    borderWidth: 2
                },
                {
                    label: 'NAP Nodes',
                    data: [],
                    borderColor: '#107c10',
                    backgroundColor: 'rgba(16, 124, 16, 0.1)',
                    fill: false,
                    tension: 0.2,
                    pointRadius: 2,
                    borderWidth: 2
                },
                {
                    label: 'Pods',
                    data: [],
                    borderColor: '#8764b8',
                    backgroundColor: 'rgba(135, 100, 184, 0.1)',
                    fill: false,
                    tension: 0.2,
                    pointRadius: 2,
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: {
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    suggestedMax: 60,
                    ticks: {
                        stepSize: 10
                    }
                },
                x: {
                    display: true,
                    ticks: {
                        maxTicksLimit: 8,
                        maxRotation: 0
                    }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            },
            elements: {
                line: {
                    borderWidth: 2
                },
                point: {
                    radius: 0,
                    hoverRadius: 4
                }
            }
        }
    });

    // Node distribution chart
    const nodeDistCtx = document.getElementById('nodeDistChart').getContext('2d');
    nodeDistChart = new Chart(nodeDistCtx, {
        type: 'doughnut',
        data: {
            labels: ['System Nodes', 'NAP On-Demand', 'NAP Spot'],
            datasets: [{
                data: [0, 0, 0],
                backgroundColor: ['#605e5c', '#0078d4', '#107c10'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

// Update all dashboard components
function updateDashboard(state) {
    updateMetrics(state);
    
    // Throttle chart updates for performance
    const now = Date.now();
    if (now - lastChartUpdate > CHART_UPDATE_INTERVAL) {
        updateCharts(state);
        lastChartUpdate = now;
    }
    
    updateNodes(state.nodes || []);
    updatePods(state.pods || []);
    updateEvents(state.events || []);
    updateDemoStatus(state.demoStatus);
    
    // Update last update time
    document.getElementById('lastUpdate').textContent = 
        new Date(state.lastUpdate).toLocaleTimeString();
}

// Update metric cards
function updateMetrics(state) {
    const nodes = state.nodes || [];
    const pods = state.pods || [];
    const events = state.events || [];
    
    const napNodes = nodes.filter(n => n.isNapManaged).length;
    // System nodes = nodes that are NOT Karpenter-managed (excludes both NAP and system-surge)
    const systemNodes = nodes.filter(n => !n.isKarpenterManaged).length;
    const spotNodes = nodes.filter(n => n.isSpot).length;
    
    // Only count pods scheduled on NAP nodes (not system nodes)
    const napPods = pods.filter(p => p.isOnNapNode).length;
    
    animateNumber('totalNodes', nodes.length);
    animateNumber('systemNodes', systemNodes);
    animateNumber('napNodes', napNodes);
    animateNumber('totalPods', napPods);  // Changed to only NAP pods
    animateNumber('spotNodes', spotNodes);
    animateNumber('eventCount', events.length);
    
    // Update pod target from demo status
    if (state.demoStatus) {
        document.getElementById('podTarget').textContent = state.demoStatus.targetReplicas || 1;
    }
}

// Animate number changes
function animateNumber(elementId, target) {
    const el = document.getElementById(elementId);
    const current = parseInt(el.textContent) || 0;
    
    if (current !== target) {
        el.textContent = target;
        el.style.transform = 'scale(1.2)';
        setTimeout(() => {
            el.style.transform = 'scale(1)';
        }, 200);
    }
}

// Update charts with history data
function updateCharts(state) {
    const history = state.history || [];
    
    // Update scaling chart - limit to last MAX_CHART_POINTS entries
    if (history.length > 0) {
        const recentHistory = history.slice(-MAX_CHART_POINTS);
        
        scalingChart.data.labels = recentHistory.map(h => 
            new Date(h.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
        );
        scalingChart.data.datasets[0].data = recentHistory.map(h => h.nodeCount);
        scalingChart.data.datasets[1].data = recentHistory.map(h => h.napNodes);
        scalingChart.data.datasets[2].data = recentHistory.map(h => h.podCount);
        scalingChart.update('none');
    }
    
    // Update node distribution chart
    const nodes = state.nodes || [];
    const systemNodes = nodes.filter(n => !n.isNapManaged).length;
    const napOnDemand = nodes.filter(n => n.isNapManaged && !n.isSpot).length;
    const napSpot = nodes.filter(n => n.isNapManaged && n.isSpot).length;
    
    nodeDistChart.data.datasets[0].data = [systemNodes, napOnDemand, napSpot];
    nodeDistChart.update('none');
}

// Update nodes grid - now with separate system and NAP sections
function updateNodes(nodes) {
    const systemGrid = document.getElementById('systemNodesGrid');
    const napGrid = document.getElementById('napNodesGrid');
    
    // Separate nodes by type
    // System nodes = NOT Karpenter-managed (excludes both NAP pool and system-surge)
    const systemNodes = nodes.filter(n => !n.isKarpenterManaged);
    const napNodes = nodes.filter(n => n.isNapManaged);
    
    // Update counts
    document.getElementById('systemPoolCount').textContent = `${systemNodes.length} node${systemNodes.length !== 1 ? 's' : ''}`;
    document.getElementById('napPoolCount').textContent = `${napNodes.length} node${napNodes.length !== 1 ? 's' : ''}`;
    
    // Render system nodes
    systemGrid.innerHTML = systemNodes.map(node => renderNodeCard(node, false)).join('') || 
        '<div class="empty-pool">No system nodes</div>';
    
    // Render NAP nodes
    napGrid.innerHTML = napNodes.map(node => renderNodeCard(node, true)).join('') || 
        '<div class="empty-pool">No NAP-provisioned nodes yet. Click "Start Demo" to trigger scaling!</div>';
}

// Render a single node card with detailed SKU information
function renderNodeCard(node, showNapBadge) {
    const classes = ['node-card'];
    if (node.isNapManaged) classes.push('nap-managed');
    if (node.isSpot) classes.push('spot');
    
    // Extract SKU family from VM size (e.g., "Standard_D2ls_v5" -> "D-series v5")
    const skuFamily = extractSkuFamily(node.vmSize);
    const capacityType = node.isSpot ? 'Spot' : 'On-Demand';
    
    return `
        <div class="${classes.join(' ')}" data-name="${node.name}">
            <div class="node-header">
                <span class="node-name">${truncateName(node.name)}</span>
                <span class="node-status ${node.status.toLowerCase()}">${node.status}</span>
            </div>
            <div class="node-sku">
                <div class="sku-main">${node.vmSize || 'Unknown'}</div>
                <div class="sku-family">${skuFamily}</div>
            </div>
            <div class="node-badges">
                ${showNapBadge ? '<span class="node-badge nap">NAP</span>' : '<span class="node-badge system">System</span>'}
                <span class="node-badge ${node.isSpot ? 'spot' : 'ondemand'}">${capacityType}</span>
            </div>
            <div class="node-utilization">
                <div class="utilization-row">
                    <span class="util-label">CPU</span>
                    <div class="util-bar-container">
                        <div class="util-bar cpu-bar" style="width: ${node.usagePercent?.cpu || 0}%"></div>
                    </div>
                    <span class="util-value">${node.usagePercent?.cpu || 0}%</span>
                </div>
                <div class="utilization-row">
                    <span class="util-label">MEM</span>
                    <div class="util-bar-container">
                        <div class="util-bar mem-bar" style="width: ${node.usagePercent?.memory || 0}%"></div>
                    </div>
                    <span class="util-value">${node.usagePercent?.memory || 0}%</span>
                </div>
            </div>
            <div class="node-pods">
                <div class="pods-bar">
                    ${Array(Math.min(node.podCount || 0, 20)).fill('<div class="pod-dot"></div>').join('')}
                    ${(node.podCount || 0) > 20 ? '<span class="pods-more">+' + ((node.podCount || 0) - 20) + '</span>' : ''}
                </div>
                <span class="pods-count">${node.podCount || 0} pods</span>
            </div>
        </div>
    `;
}

// Extract SKU family description from VM size
function extractSkuFamily(vmSize) {
    if (!vmSize) return 'Unknown';
    
    // Match patterns like Standard_D2ls_v5, Standard_E4s_v5
    const match = vmSize.match(/Standard_([A-Z])(\d+)[a-z]*s?_v(\d+)/i);
    if (match) {
        const family = match[1].toUpperCase();
        const version = match[3];
        const familyNames = {
            'D': 'General Purpose',
            'E': 'Memory Optimized',
            'F': 'Compute Optimized',
            'B': 'Burstable',
            'L': 'Storage Optimized',
            'N': 'GPU Enabled'
        };
        const familyName = familyNames[family] || family + '-series';
        return `${familyName} v${version}`;
    }
    return vmSize;
}

// Update pods table
function updatePods(pods) {
    const tbody = document.getElementById('podsTable');
    
    const html = pods.map(pod => `
        <tr>
            <td>${truncateName(pod.name)}</td>
            <td>${truncateName(pod.nodeName) || 'Pending'}</td>
            <td><span class="pod-status ${pod.status.toLowerCase()}">${pod.status}</span></td>
            <td>${pod.cpu || '-'}</td>
            <td>${pod.memory || '-'}</td>
            <td>${formatAge(pod.createdAt)}</td>
        </tr>
    `).join('');
    
    tbody.innerHTML = html || '<tr><td colspan="6" style="text-align: center;">No pods running</td></tr>';
}

// Update events timeline
function updateEvents(events) {
    const timeline = document.getElementById('eventsTimeline');
    
    // Sort by timestamp descending
    const sortedEvents = [...events].sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
    );
    
    const html = sortedEvents.slice(0, 30).map(event => {
        const explanation = getEventExplanation(event.reason);
        // Detect NAP/Karpenter events (actual event names from Karpenter)
        const napEventPatterns = [
            'Nominated', 'NominatePod', 'Provisioning', 'ProvisionedNodeClaim', 
            'Launched', 'LaunchedNodeClaim', 'Registered', 'RegisteredNode', 'Initialized',
            'Consolidating', 'Unconsolidatable', 'Disrupting', 'DisruptionTerminating', 
            'DisruptionBlocked', 'Drifted', 'Emptied', 'Deleted', 'Terminating', 'FailedDraining',
            'TriggeredScaleUp', 'ScaledUpGroup', 'VMEventScheduled'
        ];
        const isNapEvent = napEventPatterns.includes(event.reason);
        
        return `
            <div class="event-item">
                <span class="event-time">${formatTime(event.timestamp)}</span>
                <div class="event-icon ${event.type.toLowerCase()}">${getEventIcon(event.reason)}</div>
                <div class="event-content">
                    <div class="event-header">
                        <span class="event-reason" title="${explanation}">${event.reason}</span>
                        ${isNapEvent ? '<span class="event-type-badge nap">NAP</span>' : ''}
                        <span class="event-info-icon" title="${explanation}">ℹ️</span>
                    </div>
                    <div class="event-message">${event.message}</div>
                    <div class="event-object">${event.object}</div>
                </div>
            </div>
        `;
    }).join('');
    
    timeline.innerHTML = html || '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">No events yet</div>';
}

// Update demo status
function updateDemoStatus(status) {
    if (!status) return;
    
    const startBtn = document.getElementById('startDemo');
    const stopBtn = document.getElementById('stopDemo');
    const phaseEl = document.getElementById('demoPhase');
    const replicasEl = document.getElementById('targetReplicas');
    
    if (status.isRunning) {
        startBtn.disabled = true;
        stopBtn.disabled = false;
    } else {
        startBtn.disabled = false;
        stopBtn.disabled = true;
    }
    
    phaseEl.textContent = formatPhase(status.phase);
    replicasEl.textContent = status.targetReplicas || '-';
}

// API calls
async function startDemo() {
    try {
        const response = await fetch('/api/demo/start', { method: 'POST' });
        const result = await response.json();
        console.log('Demo started:', result);
    } catch (error) {
        console.error('Error starting demo:', error);
        alert('Failed to start demo. Check console for details.');
    }
}

async function stopDemo() {
    try {
        const response = await fetch('/api/demo/stop', { method: 'POST' });
        const result = await response.json();
        console.log('Demo stopped:', result);
    } catch (error) {
        console.error('Error stopping demo:', error);
        alert('Failed to stop demo. Check console for details.');
    }
}

// Utility functions
function truncateName(name) {
    if (!name) return '';
    return name.length > 30 ? name.substring(0, 27) + '...' : name;
}

function formatMemory(memory) {
    if (!memory) return '-';
    // Convert from Ki to Gi
    const match = memory.match(/^(\d+)Ki$/);
    if (match) {
        const gi = parseInt(match[1]) / 1024 / 1024;
        return gi.toFixed(1) + 'Gi';
    }
    return memory;
}

function formatAge(timestamp) {
    if (!timestamp) return '-';
    const seconds = Math.floor((new Date() - new Date(timestamp)) / 1000);
    
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
}

function formatTime(timestamp) {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

function formatPhase(phase) {
    if (!phase) return 'Idle';
    return phase.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

function getEventIcon(reason) {
    const icons = {
        'Scheduled': '📍',
        'FailedScheduling': '⚠️',
        'ScalingReplicaSet': '📈',
        'SuccessfulCreate': '✨',
        'Pulled': '📥',
        'Started': '▶️',
        'NodeReady': '✅',
        'NodeNotReady': '❌',
        'RegisteredNode': '➕',
        'Provisioned': '🚀',
        'Deprovisioned': '🗑️',
        'Consolidated': '📦'
    };
    return icons[reason] || '📌';
}
