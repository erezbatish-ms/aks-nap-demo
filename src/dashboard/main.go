/*
AKS NAP Demo Dashboard
Real-time visualization of Node Auto-Provisioning behavior

Features:
- Live node and pod monitoring via Kubernetes API watches
- WebSocket streaming to frontend
- Demo control endpoints (start/stop simulation)
- Historical data tracking for graphs
*/
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// Configuration from environment
var (
	watchNamespace     = getEnv("WATCH_NAMESPACE", "nap-demo")
	workloadDeployment = getEnv("WORKLOAD_DEPLOYMENT", "cpu-stress")
	logLevel           = getEnv("LOG_LEVEL", "info")
)

// ClusterState holds the current state of the cluster
type ClusterState struct {
	sync.RWMutex
	Nodes           []NodeInfo           `json:"nodes"`
	Pods            []PodInfo            `json:"pods"`
	Events          []EventInfo          `json:"events"`
	NodeClaims      []NodeClaimInfo      `json:"nodeClaims"`
	DemoStatus      DemoStatus           `json:"demoStatus"`
	History         []HistoryPoint       `json:"history"`
	LastUpdate      time.Time            `json:"lastUpdate"`
}

// NodeInfo represents a cluster node
type NodeInfo struct {
	Name              string            `json:"name"`
	Status            string            `json:"status"`
	CreatedAt         time.Time         `json:"createdAt"`
	Labels            map[string]string `json:"labels"`
	Capacity          ResourceInfo      `json:"capacity"`
	Allocatable       ResourceInfo      `json:"allocatable"`
	Usage             ResourceInfo      `json:"usage"`
	UsagePercent      ResourcePercent   `json:"usagePercent"`
	VMSize            string            `json:"vmSize"`
	IsSpot            bool              `json:"isSpot"`
	IsNAPManaged      bool              `json:"isNapManaged"`
	IsKarpenterManaged bool             `json:"isKarpenterManaged"`
	PodCount          int               `json:"podCount"`
}

// ResourcePercent represents CPU/memory usage percentage
type ResourcePercent struct {
	CPU    int `json:"cpu"`
	Memory int `json:"memory"`
}

// PodInfo represents a pod
type PodInfo struct {
	Name        string    `json:"name"`
	Namespace   string    `json:"namespace"`
	NodeName    string    `json:"nodeName"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	CPU         string    `json:"cpu"`
	Memory      string    `json:"memory"`
	IsOnNAPNode bool      `json:"isOnNapNode"`
}

// EventInfo represents a Kubernetes event
type EventInfo struct {
	Type      string    `json:"type"`
	Reason    string    `json:"reason"`
	Message   string    `json:"message"`
	Object    string    `json:"object"`
	Timestamp time.Time `json:"timestamp"`
	Source    string    `json:"source"`
}

// NodeClaimInfo represents a Karpenter NodeClaim
type NodeClaimInfo struct {
	Name       string    `json:"name"`
	Status     string    `json:"status"`
	NodeName   string    `json:"nodeName"`
	VMSize     string    `json:"vmSize"`
	CreatedAt  time.Time `json:"createdAt"`
}

// ResourceInfo represents CPU/memory resources
type ResourceInfo struct {
	CPU    string `json:"cpu"`
	Memory string `json:"memory"`
}

// DemoStatus tracks the demo simulation state
type DemoStatus struct {
	IsRunning       bool      `json:"isRunning"`
	TargetReplicas  int       `json:"targetReplicas"`
	CurrentReplicas int       `json:"currentReplicas"`
	Phase           string    `json:"phase"`
	StartedAt       time.Time `json:"startedAt,omitempty"`
}

// HistoryPoint records cluster state over time
type HistoryPoint struct {
	Timestamp time.Time `json:"timestamp"`
	NodeCount int       `json:"nodeCount"`
	PodCount  int       `json:"podCount"`
	NAPNodes  int       `json:"napNodes"`
}

// ClusterInfo holds AKS cluster configuration details
type ClusterInfo struct {
	ClusterName       string         `json:"clusterName"`
	KubernetesVersion string         `json:"kubernetesVersion"`
	Region            string         `json:"region"`
	ResourceGroup     string         `json:"resourceGroup"`
	CNI               string         `json:"cni"`
	NetworkPlugin     string         `json:"networkPlugin"`
	NetworkPolicy     string         `json:"networkPolicy"`
	NAPEnabled        bool           `json:"napEnabled"`
	NodePoolConfig    NodePoolConfig `json:"nodePoolConfig"`
	ProviderID        string         `json:"providerID"`
}

// NodePoolConfig holds NodePool configuration from Karpenter
type NodePoolConfig struct {
	Name                string   `json:"name"`
	SKUFamilies         []string `json:"skuFamilies"`
	CapacityTypes       []string `json:"capacityTypes"`
	CPUSizes            []string `json:"cpuSizes"`
	ConsolidationPolicy string   `json:"consolidationPolicy"`
	ConsolidateAfter    string   `json:"consolidateAfter"`
	CPULimit            string   `json:"cpuLimit"`
	MemoryLimit         string   `json:"memoryLimit"`
}

// Global state
var (
	state         = &ClusterState{}
	clients       = make(map[*websocket.Conn]bool)
	clientsMutex  sync.RWMutex
	upgrader      = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	k8sClient     *kubernetes.Clientset
	dynamicClient dynamic.Interface
	demoCancel    context.CancelFunc
)

func main() {
	log.Println("========================================")
	log.Println("AKS NAP Demo Dashboard")
	log.Println("========================================")
	log.Printf("Watch Namespace: %s", watchNamespace)
	log.Printf("Workload Deployment: %s", workloadDeployment)

	// Initialize Kubernetes client
	if err := initK8sClient(); err != nil {
		log.Fatalf("Failed to initialize Kubernetes client: %v", err)
	}

	// Sync demo state with current cluster state
	syncDemoState()

	// Start watchers
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go watchNodes(ctx)
	go watchPods(ctx)
	go watchEvents(ctx)
	go watchNodeClaims(ctx)
	go recordHistory(ctx)

	// Setup HTTP routes
	router := mux.NewRouter()
	
	// Static files
	router.PathPrefix("/static/").Handler(http.StripPrefix("/static/", http.FileServer(http.Dir("./static"))))
	router.HandleFunc("/", serveIndex)
	
	// API endpoints
	router.HandleFunc("/api/state", handleGetState).Methods("GET")
	router.HandleFunc("/api/cluster", handleGetClusterInfo).Methods("GET")
	router.HandleFunc("/api/demo/start", handleStartDemo).Methods("POST")
	router.HandleFunc("/api/demo/stop", handleStopDemo).Methods("POST")
	router.HandleFunc("/api/demo/status", handleDemoStatus).Methods("GET")
	
	// Health endpoints
	router.HandleFunc("/health", handleHealth).Methods("GET")
	router.HandleFunc("/ready", handleReady).Methods("GET")
	
	// WebSocket
	router.HandleFunc("/ws", handleWebSocket)

	// Start servers
	go func() {
		log.Println("HTTP server starting on :8080")
		if err := http.ListenAndServe(":8080", router); err != nil {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	// Broadcast state updates periodically
	go broadcastLoop(ctx)

	// Wait for shutdown signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)
	<-sigChan
	
	log.Println("Shutting down...")
	cancel()
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func initK8sClient() error {
	config, err := rest.InClusterConfig()
	if err != nil {
		return fmt.Errorf("failed to get in-cluster config: %w", err)
	}

	k8sClient, err = kubernetes.NewForConfig(config)
	if err != nil {
		return fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	dynamicClient, err = dynamic.NewForConfig(config)
	if err != nil {
		return fmt.Errorf("failed to create dynamic client: %w", err)
	}

	log.Println("Kubernetes client initialized successfully")
	return nil
}

// syncDemoState checks the current deployment state and syncs the demo status
func syncDemoState() {
	deployment, err := k8sClient.AppsV1().Deployments(watchNamespace).Get(context.Background(), workloadDeployment, metav1.GetOptions{})
	if err != nil {
		log.Printf("Warning: Could not get deployment state: %v", err)
		return
	}
	
	currentReplicas := int(*deployment.Spec.Replicas)
	log.Printf("Current deployment replicas: %d", currentReplicas)
	
	state.Lock()
	if currentReplicas > 1 {
		// Demo appears to be running or was interrupted
		state.DemoStatus = DemoStatus{
			IsRunning:       true,
			Phase:           "recovered",
			StartedAt:       time.Now(),
			TargetReplicas:  currentReplicas,
			CurrentReplicas: currentReplicas,
		}
		log.Printf("Detected running demo state with %d replicas", currentReplicas)
	} else {
		state.DemoStatus = DemoStatus{
			IsRunning:       false,
			Phase:           "idle",
			TargetReplicas:  1,
			CurrentReplicas: 1,
		}
	}
	state.Unlock()
}

// NodeMetricsGVR is the GroupVersionResource for node metrics
var nodeMetricsGVR = schema.GroupVersionResource{
	Group:    "metrics.k8s.io",
	Version:  "v1beta1",
	Resource: "nodes",
}

// getNodeMetrics fetches node metrics from metrics-server
func getNodeMetrics(ctx context.Context) map[string]ResourceInfo {
	metrics := make(map[string]ResourceInfo)
	
	list, err := dynamicClient.Resource(nodeMetricsGVR).List(ctx, metav1.ListOptions{})
	if err != nil {
		// Metrics server might not be available, log at debug level
		if logLevel == "debug" {
			log.Printf("Error fetching node metrics: %v", err)
		}
		return metrics
	}
	
	for _, item := range list.Items {
		name := item.GetName()
		usage, found, _ := unstructured.NestedMap(item.Object, "usage")
		if found {
			cpuVal, _, _ := unstructured.NestedString(usage, "cpu")
			memVal, _, _ := unstructured.NestedString(usage, "memory")
			metrics[name] = ResourceInfo{
				CPU:    cpuVal,
				Memory: memVal,
			}
		}
	}
	
	return metrics
}

// parseCPU parses CPU value to millicores
func parseCPU(cpuStr string) int64 {
	if cpuStr == "" {
		return 0
	}
	// Handle formats like "250m", "1", "1000n"
	if len(cpuStr) > 1 && cpuStr[len(cpuStr)-1] == 'n' {
		// nanocores to millicores
		val := parseInt64(cpuStr[:len(cpuStr)-1])
		return val / 1000000
	}
	if len(cpuStr) > 1 && cpuStr[len(cpuStr)-1] == 'm' {
		return parseInt64(cpuStr[:len(cpuStr)-1])
	}
	// Whole cores to millicores
	return parseInt64(cpuStr) * 1000
}

// parseMemory parses memory value to bytes
func parseMemory(memStr string) int64 {
	if memStr == "" {
		return 0
	}
	// Handle formats like "1Gi", "1024Mi", "1048576Ki"
	multipliers := map[string]int64{
		"Ki": 1024,
		"Mi": 1024 * 1024,
		"Gi": 1024 * 1024 * 1024,
		"Ti": 1024 * 1024 * 1024 * 1024,
	}
	for suffix, mult := range multipliers {
		if len(memStr) > len(suffix) && memStr[len(memStr)-len(suffix):] == suffix {
			return parseInt64(memStr[:len(memStr)-len(suffix)]) * mult
		}
	}
	return parseInt64(memStr)
}

func parseInt64(s string) int64 {
	var val int64
	fmt.Sscanf(s, "%d", &val)
	return val
}

func watchNodes(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		// Fetch node metrics first
		nodeMetrics := getNodeMetrics(ctx)

		nodes, err := k8sClient.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
		if err != nil {
			log.Printf("Error listing nodes: %v", err)
			time.Sleep(5 * time.Second)
			continue
		}

		var nodeInfos []NodeInfo
		
		// Get current pod counts to preserve them
		state.RLock()
		currentPodCounts := make(map[string]int)
		for _, node := range state.Nodes {
			currentPodCounts[node.Name] = node.PodCount
		}
		state.RUnlock()
		
		for _, node := range nodes.Items {
			info := NodeInfo{
				Name:      node.Name,
				CreatedAt: node.CreationTimestamp.Time,
				Labels:    node.Labels,
				PodCount:  currentPodCounts[node.Name], // Preserve pod count
				Capacity: ResourceInfo{
					CPU:    node.Status.Capacity.Cpu().String(),
					Memory: node.Status.Capacity.Memory().String(),
				},
				Allocatable: ResourceInfo{
					CPU:    node.Status.Allocatable.Cpu().String(),
					Memory: node.Status.Allocatable.Memory().String(),
				},
			}
			
			// Add usage metrics if available
			if usage, ok := nodeMetrics[node.Name]; ok {
				info.Usage = usage
				
				// Calculate usage percentages
				allocCPU := parseCPU(node.Status.Allocatable.Cpu().String())
				allocMem := parseMemory(node.Status.Allocatable.Memory().String())
				usageCPU := parseCPU(usage.CPU)
				usageMem := parseMemory(usage.Memory)
				
				if allocCPU > 0 {
					info.UsagePercent.CPU = int(usageCPU * 100 / allocCPU)
				}
				if allocMem > 0 {
					info.UsagePercent.Memory = int(usageMem * 100 / allocMem)
				}
			}

			// Determine node status
			info.Status = "Unknown"
			for _, condition := range node.Status.Conditions {
				if condition.Type == corev1.NodeReady {
					if condition.Status == corev1.ConditionTrue {
						info.Status = "Ready"
					} else {
						info.Status = "NotReady"
					}
					break
				}
			}

			// Check if Karpenter-managed (any nodepool)
			if nodepool, ok := node.Labels["karpenter.sh/nodepool"]; ok {
				info.IsKarpenterManaged = true
				// Only mark as NAP-managed if it's the demo pool
				if nodepool == "nap-demo-pool" {
					info.IsNAPManaged = true
				}
			}

			// Get VM size from labels
			if vmSize, ok := node.Labels["node.kubernetes.io/instance-type"]; ok {
				info.VMSize = vmSize
			}

			// Check if Spot
			if capacityType, ok := node.Labels["karpenter.sh/capacity-type"]; ok && capacityType == "spot" {
				info.IsSpot = true
			}

			nodeInfos = append(nodeInfos, info)
		}

		state.Lock()
		state.Nodes = nodeInfos
		state.LastUpdate = time.Now()
		state.Unlock()

		time.Sleep(1 * time.Second)
	}
}

func watchPods(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		pods, err := k8sClient.CoreV1().Pods(watchNamespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			log.Printf("Error listing pods: %v", err)
			time.Sleep(5 * time.Second)
			continue
		}

		// Build a map of NAP nodes from current state
		state.RLock()
		napNodes := make(map[string]bool)
		for _, node := range state.Nodes {
			if node.IsNAPManaged {
				napNodes[node.Name] = true
			}
		}
		state.RUnlock()

		var podInfos []PodInfo
		podsByNode := make(map[string]int)

		for _, pod := range pods.Items {
			info := PodInfo{
				Name:        pod.Name,
				Namespace:   pod.Namespace,
				NodeName:    pod.Spec.NodeName,
				Status:      string(pod.Status.Phase),
				CreatedAt:   pod.CreationTimestamp.Time,
				IsOnNAPNode: napNodes[pod.Spec.NodeName],
			}

			// Get resource requests
			for _, container := range pod.Spec.Containers {
				if cpu := container.Resources.Requests.Cpu(); cpu != nil {
					info.CPU = cpu.String()
				}
				if mem := container.Resources.Requests.Memory(); mem != nil {
					info.Memory = mem.String()
				}
			}

			podInfos = append(podInfos, info)
			podsByNode[pod.Spec.NodeName]++
		}

		state.Lock()
		state.Pods = podInfos
		// Update pod counts per node
		for i := range state.Nodes {
			state.Nodes[i].PodCount = podsByNode[state.Nodes[i].Name]
		}
		state.LastUpdate = time.Now()
		state.Unlock()

		time.Sleep(1 * time.Second)
	}
}

func watchEvents(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		events, err := k8sClient.CoreV1().Events("").List(ctx, metav1.ListOptions{
			Limit: 100,
		})
		if err != nil {
			log.Printf("Error listing events: %v", err)
			time.Sleep(5 * time.Second)
			continue
		}

		var eventInfos []EventInfo
		for _, event := range events.Items {
			// Filter for relevant events (NAP, scheduling, scaling)
			if isRelevantEvent(event) {
				info := EventInfo{
					Type:      event.Type,
					Reason:    event.Reason,
					Message:   event.Message,
					Object:    fmt.Sprintf("%s/%s", event.InvolvedObject.Kind, event.InvolvedObject.Name),
					Timestamp: event.LastTimestamp.Time,
					Source:    event.Source.Component,
				}
				eventInfos = append(eventInfos, info)
			}
		}

		// Keep only last 50 events
		if len(eventInfos) > 50 {
			eventInfos = eventInfos[len(eventInfos)-50:]
		}

		state.Lock()
		state.Events = eventInfos
		state.Unlock()

		time.Sleep(1 * time.Second)
	}
}

func isRelevantEvent(event corev1.Event) bool {
	relevantReasons := []string{
		"Scheduled", "FailedScheduling", "ScalingReplicaSet",
		"SuccessfulCreate", "Pulled", "Started",
		"NodeReady", "NodeNotReady", "RegisteredNode",
		"Provisioned", "Deprovisioned", "Consolidated",
	}
	
	for _, reason := range relevantReasons {
		if event.Reason == reason {
			return true
		}
	}
	
	// Include Karpenter events
	if event.Source.Component == "karpenter" {
		return true
	}
	
	return false
}

func watchNodeClaims(ctx context.Context) {
	nodeClaimGVR := schema.GroupVersionResource{
		Group:    "karpenter.sh",
		Version:  "v1",
		Resource: "nodeclaims",
	}

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		claims, err := dynamicClient.Resource(nodeClaimGVR).List(ctx, metav1.ListOptions{})
		if err != nil {
			// NodeClaims might not exist if NAP hasn't provisioned anything yet
			time.Sleep(5 * time.Second)
			continue
		}

		var claimInfos []NodeClaimInfo
		for _, item := range claims.Items {
			info := NodeClaimInfo{
				Name:      item.GetName(),
				CreatedAt: item.GetCreationTimestamp().Time,
			}

			// Get status
			if status, found, _ := unstructured.NestedString(item.Object, "status", "conditions", "type"); found {
				info.Status = status
			}

			// Get node name
			if nodeName, found, _ := unstructured.NestedString(item.Object, "status", "nodeName"); found {
				info.NodeName = nodeName
			}

			claimInfos = append(claimInfos, info)
		}

		state.Lock()
		state.NodeClaims = claimInfos
		state.Unlock()

		time.Sleep(3 * time.Second)
	}
}

func recordHistory(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			state.RLock()
			// Count only pods on NAP nodes for history
			napPodCount := 0
			for _, pod := range state.Pods {
				if pod.IsOnNAPNode {
					napPodCount++
				}
			}
			point := HistoryPoint{
				Timestamp: time.Now(),
				NodeCount: len(state.Nodes),
				PodCount:  napPodCount,  // Only pods on NAP nodes
			}
			for _, node := range state.Nodes {
				if node.IsNAPManaged {
					point.NAPNodes++
				}
			}
			state.RUnlock()

			state.Lock()
			state.History = append(state.History, point)
			// Keep last 360 points (1 hour at 10s intervals)
			if len(state.History) > 360 {
				state.History = state.History[1:]
			}
			state.Unlock()
		}
	}
}

func broadcastLoop(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			broadcastState()
		}
	}
}

func broadcastState() {
	state.RLock()
	data, err := json.Marshal(state)
	state.RUnlock()

	if err != nil {
		log.Printf("Error marshaling state: %v", err)
		return
	}

	clientsMutex.RLock()
	for client := range clients {
		err := client.WriteMessage(websocket.TextMessage, data)
		if err != nil {
			log.Printf("WebSocket write error: %v", err)
			client.Close()
			delete(clients, client)
		}
	}
	clientsMutex.RUnlock()
}

// HTTP Handlers

func serveIndex(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "./static/index.html")
}

func handleGetState(w http.ResponseWriter, r *http.Request) {
	state.RLock()
	defer state.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(state)
}

// NodePoolGVR is the GroupVersionResource for Karpenter NodePools
var nodePoolGVR = schema.GroupVersionResource{
	Group:    "karpenter.sh",
	Version:  "v1",
	Resource: "nodepools",
}

// handleGetClusterInfo returns AKS cluster configuration
func handleGetClusterInfo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	info := ClusterInfo{
		NAPEnabled: true, // We know NAP is enabled since we're running
	}

	// Get cluster info from a node's providerID
	nodes, err := k8sClient.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err == nil && len(nodes.Items) > 0 {
		node := nodes.Items[0]

		// Parse providerID
		info.ProviderID = node.Spec.ProviderID
		if parts := parseAzureProviderID(node.Spec.ProviderID); parts != nil {
			info.ResourceGroup = parts["resourceGroup"]
		}
		info.Region = node.Labels["topology.kubernetes.io/region"]

		// Get Kubernetes version
		info.KubernetesVersion = node.Status.NodeInfo.KubeletVersion

		// Check for Cilium CNI
		if _, ok := node.Labels["kubernetes.azure.com/ebpf-dataplane"]; ok {
			info.CNI = "Cilium"
			info.NetworkPlugin = "Azure CNI Overlay"
			info.NetworkPolicy = "Cilium"
		} else {
			info.CNI = "Azure CNI"
			info.NetworkPlugin = "Azure"
			info.NetworkPolicy = "Azure"
		}

		// Get cluster name from node labels
		if clusterName, ok := node.Labels["kubernetes.azure.com/cluster"]; ok {
			info.ClusterName = clusterName
		}
	}

	// Get NodePool configuration
	nodepool, err := dynamicClient.Resource(nodePoolGVR).Get(ctx, "nap-demo-pool", metav1.GetOptions{})
	if err == nil {
		info.NodePoolConfig = parseNodePoolConfig(nodepool)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(info)
}

// parseAzureProviderID extracts resource group and other info from Azure provider ID
func parseAzureProviderID(providerID string) map[string]string {
	result := make(map[string]string)
	// Format: azure:///subscriptions/{sub}/resourceGroups/{rg}/providers/...
	parts := strings.Split(providerID, "/")
	for i, part := range parts {
		if strings.EqualFold(part, "resourceGroups") && i+1 < len(parts) {
			result["resourceGroup"] = parts[i+1]
		}
		if strings.EqualFold(part, "subscriptions") && i+1 < len(parts) {
			result["subscription"] = parts[i+1]
		}
	}
	return result
}

// parseNodePoolConfig extracts configuration from Karpenter NodePool
func parseNodePoolConfig(nodepool *unstructured.Unstructured) NodePoolConfig {
	config := NodePoolConfig{
		Name: nodepool.GetName(),
	}

	// Get spec.template.spec.requirements
	requirements, found, _ := unstructured.NestedSlice(nodepool.Object, "spec", "template", "spec", "requirements")
	if found {
		for _, req := range requirements {
			reqMap, ok := req.(map[string]interface{})
			if !ok {
				continue
			}
			key, _, _ := unstructured.NestedString(reqMap, "key")
			values, _, _ := unstructured.NestedStringSlice(reqMap, "values")

			switch key {
			case "karpenter.azure.com/sku-family":
				config.SKUFamilies = values
			case "karpenter.sh/capacity-type":
				config.CapacityTypes = values
			case "karpenter.azure.com/sku-cpu":
				config.CPUSizes = values
			}
		}
	}

	// Get disruption settings
	consolidationPolicy, _, _ := unstructured.NestedString(nodepool.Object, "spec", "disruption", "consolidationPolicy")
	config.ConsolidationPolicy = consolidationPolicy

	consolidateAfter, _, _ := unstructured.NestedString(nodepool.Object, "spec", "disruption", "consolidateAfter")
	config.ConsolidateAfter = consolidateAfter

	// Get limits
	cpuLimit, found, _ := unstructured.NestedFieldNoCopy(nodepool.Object, "spec", "limits", "cpu")
	if found {
		config.CPULimit = fmt.Sprintf("%v", cpuLimit)
	}
	memLimit, found, _ := unstructured.NestedFieldNoCopy(nodepool.Object, "spec", "limits", "memory")
	if found {
		config.MemoryLimit = fmt.Sprintf("%v", memLimit)
	}

	return config
}

func handleStartDemo(w http.ResponseWriter, r *http.Request) {
	log.Println("Starting demo simulation...")

	// Cancel any existing demo
	if demoCancel != nil {
		demoCancel()
	}

	ctx, cancel := context.WithCancel(context.Background())
	demoCancel = cancel

	state.Lock()
	state.DemoStatus = DemoStatus{
		IsRunning:      true,
		TargetReplicas: 1,
		Phase:          "scaling-up",
		StartedAt:      time.Now(),
	}
	state.Unlock()

	go runDemoSimulation(ctx)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "started"})
}

func handleStopDemo(w http.ResponseWriter, r *http.Request) {
	log.Println("Stopping demo simulation...")

	if demoCancel != nil {
		demoCancel()
		demoCancel = nil
	}

	// Scale deployment back to 1
	scaleDeployment(1)

	state.Lock()
	state.DemoStatus = DemoStatus{
		IsRunning:      false,
		TargetReplicas: 1,
		Phase:          "stopped",
	}
	state.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "stopped"})
}

func handleDemoStatus(w http.ResponseWriter, r *http.Request) {
	state.RLock()
	defer state.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(state.DemoStatus)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("healthy"))
}

func handleReady(w http.ResponseWriter, r *http.Request) {
	// Check if we can reach the Kubernetes API by listing pods in our namespace
	_, err := k8sClient.CoreV1().Pods(watchNamespace).List(context.Background(), metav1.ListOptions{Limit: 1})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte("not ready"))
		return
	}
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ready"))
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	clientsMutex.Lock()
	clients[conn] = true
	clientsMutex.Unlock()

	log.Printf("New WebSocket client connected. Total clients: %d", len(clients))

	// Send initial state
	state.RLock()
	data, _ := json.Marshal(state)
	state.RUnlock()
	conn.WriteMessage(websocket.TextMessage, data)

	// Keep connection alive and handle disconnection
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			clientsMutex.Lock()
			delete(clients, conn)
			clientsMutex.Unlock()
			conn.Close()
			log.Printf("WebSocket client disconnected. Total clients: %d", len(clients))
			return
		}
	}
}

func runDemoSimulation(ctx context.Context) {
	// Scale-up phases: 1 -> 10 -> 20 -> 30 -> 40 -> 50
	// This creates enough pods to trigger NAP to provision multiple nodes
	scaleUpSteps := []int{10, 20, 30, 40, 50}
	
	// Scale up
	for _, replicas := range scaleUpSteps {
		select {
		case <-ctx.Done():
			return
		default:
		}

		log.Printf("Scaling to %d replicas...", replicas)
		scaleDeployment(replicas)

		state.Lock()
		state.DemoStatus.TargetReplicas = replicas
		state.DemoStatus.Phase = "scaling-up"
		state.Unlock()

		// Wait for pods to be ready (up to 5 minutes per step)
		if !waitForPodsReady(ctx, replicas, 5*time.Minute) {
			log.Printf("Timeout waiting for %d pods to be ready, continuing...", replicas)
		}
		
		// Additional wait to observe NAP behavior
		select {
		case <-ctx.Done():
			return
		case <-time.After(15 * time.Second):
		}
	}

	// Hold at peak for 2 minutes to observe NAP behavior
	state.Lock()
	state.DemoStatus.Phase = "peak"
	state.Unlock()

	select {
	case <-ctx.Done():
		return
	case <-time.After(2 * time.Minute):
	}

	// Scale down phases: 50 -> 30 -> 15 -> 5 -> 1
	scaleDownSteps := []int{30, 15, 5, 1}

	for _, replicas := range scaleDownSteps {
		select {
		case <-ctx.Done():
			return
		default:
		}

		log.Printf("Scaling down to %d replicas...", replicas)
		scaleDeployment(replicas)

		state.Lock()
		state.DemoStatus.TargetReplicas = replicas
		state.DemoStatus.Phase = "scaling-down"
		state.Unlock()

		// Wait for pods to scale down
		if !waitForPodsReady(ctx, replicas, 2*time.Minute) {
			log.Printf("Timeout waiting for scale down to %d pods, continuing...", replicas)
		}
		
		// Wait for NAP to consolidate nodes
		select {
		case <-ctx.Done():
			return
		case <-time.After(45 * time.Second):
		}
	}

	// Demo complete
	state.Lock()
	state.DemoStatus.IsRunning = false
	state.DemoStatus.Phase = "completed"
	state.Unlock()

	log.Println("Demo simulation completed")
}


func scaleDeployment(replicas int) {
	ctx := context.Background()
	
	scale, err := k8sClient.AppsV1().Deployments(watchNamespace).GetScale(ctx, workloadDeployment, metav1.GetOptions{})
	if err != nil {
		log.Printf("Error getting deployment scale: %v", err)
		return
	}

	scale.Spec.Replicas = int32(replicas)

	_, err = k8sClient.AppsV1().Deployments(watchNamespace).UpdateScale(ctx, workloadDeployment, scale, metav1.UpdateOptions{})
	if err != nil {
		log.Printf("Error scaling deployment: %v", err)
		return
	}

	log.Printf("Scaled deployment %s to %d replicas", workloadDeployment, replicas)

	state.Lock()
	state.DemoStatus.CurrentReplicas = replicas
	state.Unlock()
}

// waitForPodsReady waits until the deployment has the expected number of ready pods
func waitForPodsReady(ctx context.Context, expectedReplicas int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	checkInterval := 5 * time.Second
	
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return false
		default:
		}
		
		// Get deployment status
		deployment, err := k8sClient.AppsV1().Deployments(watchNamespace).Get(ctx, workloadDeployment, metav1.GetOptions{})
		if err != nil {
			log.Printf("Error getting deployment status: %v", err)
			time.Sleep(checkInterval)
			continue
		}
		
		readyReplicas := int(deployment.Status.ReadyReplicas)
		availableReplicas := int(deployment.Status.AvailableReplicas)
		
		log.Printf("Waiting for pods: ready=%d, available=%d, target=%d", 
			readyReplicas, availableReplicas, expectedReplicas)
		
		// Update state with current replica count
		state.Lock()
		state.DemoStatus.CurrentReplicas = readyReplicas
		state.Unlock()
		
		// Check if we've reached the target
		if readyReplicas >= expectedReplicas {
			log.Printf("Target reached: %d pods ready", readyReplicas)
			return true
		}
		
		// Wait before next check
		select {
		case <-ctx.Done():
			return false
		case <-time.After(checkInterval):
		}
	}
	
	return false
}
