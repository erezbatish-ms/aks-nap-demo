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
            // Properly close the old connection before reconnecting
            const oldWs = ws;
            ws = null;
            oldWs.close();
            // Reconnect will be triggered by onclose handler
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
    updateDemoHistory(state.demoHistory);
    
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
    // Special formatting for key phases
    const phaseMap = {
        'observing': '👁️ Observing (Click Stop to End)',
        'scaling-up': '⬆️ Scaling Up',
        'scaling-down': '⬇️ Scaling Down',
        'completed': '✅ Completed',
        'stopped': '⏹️ Stopped',
        'idle': '⏸️ Idle',
        'recovered': '🔄 Recovered'
    };
    if (phaseMap[phase]) return phaseMap[phase];
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

// Minimum bar width in pixels for visibility
const MIN_BAR_WIDTH = 100;

// Update demo history section
function updateDemoHistory(history) {
    if (!history) {
        // Clear history display when no history
        document.getElementById('peakNodes').textContent = '0';
        document.getElementById('peakPods').textContent = '0';
        document.getElementById('totalProvisioned').textContent = '0';
        document.getElementById('totalConsolidated').textContent = '0';
        document.getElementById('demoDuration').textContent = '0:00';
        document.getElementById('nodeTimeline').innerHTML = 
            '<div class="timeline-empty">Start a demo to see node lifecycle history</div>';
        document.getElementById('timelineAxis').innerHTML = '';
        return;
    }

    // Update summary cards
    document.getElementById('peakNodes').textContent = history.peakNodes || 0;
    document.getElementById('peakPods').textContent = history.peakPods || 0;
    document.getElementById('totalProvisioned').textContent = history.totalProvisioned || 0;
    document.getElementById('totalConsolidated').textContent = history.totalConsolidated || 0;

    // Calculate demo duration
    if (history.startedAt) {
        const startTime = new Date(history.startedAt);
        const now = new Date();
        const durationSec = Math.floor((now - startTime) / 1000);
        const minutes = Math.floor(durationSec / 60);
        const seconds = durationSec % 60;
        document.getElementById('demoDuration').textContent = 
            `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    // Render timeline
    renderNodeTimeline(history.nodeEvents || [], history.startedAt);
}

// Render the node lifecycle timeline as a Gantt chart
function renderNodeTimeline(nodeEvents, demoStartTime) {
    const timelineEl = document.getElementById('nodeTimeline');
    const axisEl = document.getElementById('timelineAxis');
    
    if (!nodeEvents || nodeEvents.length === 0) {
        timelineEl.innerHTML = '<div class="timeline-empty">No node events yet. Waiting for NAP to provision nodes...</div>';
        axisEl.innerHTML = '';
        return;
    }

    const startTime = new Date(demoStartTime);
    const now = new Date();
    
    // Calculate total duration - find the latest end time or use current time
    let maxEndTime = now;
    nodeEvents.forEach(event => {
        if (event.endTime) {
            const endTime = new Date(event.endTime);
            if (endTime > maxEndTime) maxEndTime = endTime;
        }
    });
    
    // Total duration with minimum of 60 seconds
    const totalDurationMs = Math.max(maxEndTime - startTime, 60000);
    
    // Sort events by start time
    const sortedEvents = [...nodeEvents].sort((a, b) => 
        new Date(a.startTime) - new Date(b.startTime)
    );

    // Build timeline HTML with label column and bar column
    let html = '<div class="gantt-chart">';
    
    sortedEvents.forEach((event, index) => {
        const eventStart = new Date(event.startTime);
        
        // Handle Go's zero time value for active nodes (endTime not set)
        // Go's zero time is "0001-01-01T00:00:00Z"
        const isZeroTime = !event.endTime || event.endTime.startsWith('0001-01-01');
        const eventEnd = isZeroTime ? now : new Date(event.endTime);
        
        // Calculate positions as percentages
        const startOffset = Math.max(0, eventStart - startTime);
        const duration = Math.max(0, eventEnd - eventStart); // Ensure non-negative
        
        const leftPercent = (startOffset / totalDurationMs) * 100;
        const widthPercent = (duration / totalDurationMs) * 100;
        
        // Ensure bar stays within bounds and has minimum width
        const clampedLeft = Math.min(leftPercent, 95);
        // Minimum width of 5% or calculated width, capped at remaining space
        const minWidthPercent = 5;
        const calculatedWidth = Math.max(widthPercent, minWidthPercent);
        const clampedWidth = Math.min(calculatedWidth, 100 - clampedLeft);

        const isActive = event.eventType === 'active';
        const statusClass = isActive ? 'active' : 'consolidated';
        const statusIcon = isActive ? '🟢' : '🔵';
        const statusText = isActive ? 'Active' : 'Consolidated';
        
        // Extract short node name
        const nameParts = event.nodeName.split('-');
        const shortName = nameParts.length > 2 
            ? nameParts.slice(-2).join('-') 
            : event.nodeName.substring(0, 15);
        
        // Format duration
        const durationSec = duration / 1000;
        const durationDisplay = formatDuration(durationSec);
        
        html += `
            <div class="gantt-row">
                <div class="gantt-label">
                    <span class="gantt-status-icon">${statusIcon}</span>
                    <span class="gantt-node-name" title="${event.nodeName}">${shortName}</span>
                    <span class="gantt-vm-size">${event.vmSize || ''}</span>
                </div>
                <div class="gantt-bar-container">
                    <div class="gantt-bar ${statusClass}" 
                         style="left: ${clampedLeft}%; width: ${clampedWidth}%;"
                         data-node="${event.nodeName}"
                         data-vm="${event.vmSize || 'Unknown'}"
                         data-status="${statusText}"
                         data-duration="${durationDisplay}"
                         data-reason="${event.reason || ''}">
                        <span class="gantt-bar-duration">${durationDisplay}</span>
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    timelineEl.innerHTML = html;
    
    // Add tooltip functionality
    setupTimelineTooltips();
    
    // Render time axis
    renderTimeAxis(axisEl, totalDurationMs / 1000);
}

// Setup tooltip hover behavior for timeline bars
function setupTimelineTooltips() {
    const bars = document.querySelectorAll('.gantt-bar');
    
    // Remove existing tooltip if any
    const existingTooltip = document.getElementById('gantt-tooltip');
    if (existingTooltip) existingTooltip.remove();
    
    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.id = 'gantt-tooltip';
    tooltip.className = 'gantt-tooltip';
    document.body.appendChild(tooltip);
    
    bars.forEach(bar => {
        bar.addEventListener('mouseenter', (e) => {
            const node = bar.dataset.node;
            const vm = bar.dataset.vm;
            const status = bar.dataset.status;
            const duration = bar.dataset.duration;
            const reason = bar.dataset.reason;
            
            tooltip.innerHTML = `
                <div class="tooltip-title">${node}</div>
                <div class="tooltip-row"><span>VM Size:</span> ${vm}</div>
                <div class="tooltip-row"><span>Status:</span> ${status}</div>
                <div class="tooltip-row"><span>Duration:</span> ${duration}</div>
                ${reason ? `<div class="tooltip-row"><span>Reason:</span> ${reason}</div>` : ''}
            `;
            tooltip.style.display = 'block';
        });
        
        bar.addEventListener('mousemove', (e) => {
            tooltip.style.left = (e.pageX + 15) + 'px';
            tooltip.style.top = (e.pageY - 10) + 'px';
        });
        
        bar.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
    });
}

// Render the time axis with labels
function renderTimeAxis(axisEl, totalDurationSec) {
    // Determine appropriate interval based on total duration
    let intervalSec;
    if (totalDurationSec <= 120) {
        intervalSec = 15; // 15 second intervals for short demos
    } else if (totalDurationSec <= 300) {
        intervalSec = 30; // 30 second intervals
    } else if (totalDurationSec <= 600) {
        intervalSec = 60; // 1 minute intervals
    } else {
        intervalSec = 120; // 2 minute intervals for long demos
    }
    
    let html = '<div class="gantt-axis">';
    
    for (let sec = 0; sec <= totalDurationSec; sec += intervalSec) {
        const leftPercent = (sec / totalDurationSec) * 100;
        const label = formatAxisLabel(sec);
        
        html += `
            <div class="axis-tick" style="left: ${leftPercent}%;">
                <div class="tick-mark"></div>
                <div class="tick-label">${label}</div>
            </div>
        `;
    }
    
    html += '</div>';
    axisEl.innerHTML = html;
}

// Format duration for display
function formatDuration(seconds) {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}m ${secs}s`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${mins}m`;
    }
}

// Format axis label
function formatAxisLabel(seconds) {
    if (seconds === 0) return '0s';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (secs === 0) return `${mins}m`;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
