package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"
)

type gatewayIdentity struct {
	MachineID        string
	Hostname         string
	PrimaryIPAddress string
}

func collectGatewayIdentity(config *AgentConfig) gatewayIdentity {
	hostname, _ := os.Hostname()
	return gatewayIdentity{
		MachineID:        gatewayMachineID(),
		Hostname:         hostname,
		PrimaryIPAddress: gatewayPreferredSourceIP(config),
	}
}

func gatewayMachineID() string {
	if runtime.GOOS == "linux" {
		if content, err := os.ReadFile("/etc/machine-id"); err == nil {
			if value := strings.TrimSpace(string(content)); value != "" {
				return value
			}
		}
	}
	random := make([]byte, 16)
	_, _ = rand.Read(random)
	return "gw-" + hex.EncodeToString(random)
}

func gatewayPreferredSourceIP(config *AgentConfig) string {
	host := strings.TrimSpace(config.ControlPlane)
	if host == "" {
		return ""
	}
	parsed := strings.SplitN(strings.TrimPrefix(strings.TrimPrefix(host, "https://"), "http://"), "/", 2)[0]
	if strings.Contains(parsed, ":") {
		parsed = parsed[:strings.LastIndex(parsed, ":")]
	}
	connection, err := net.DialTimeout("tcp", net.JoinHostPort(parsed, "443"), 3*time.Second)
	if err != nil {
		connection, err = net.DialTimeout("tcp", net.JoinHostPort(parsed, "80"), 3*time.Second)
	}
	if err != nil {
		return ""
	}
	defer connection.Close()
	if address, ok := connection.LocalAddr().(*net.TCPAddr); ok {
		return address.IP.String()
	}
	return ""
}

// ---- 控制面 wire 结构 ----

type registerRequest struct {
	AgentKey           string   `json:"agentKey"`
	MachineID          string   `json:"machineId,omitempty"`
	Hostname           string   `json:"hostname"`
	Version            string   `json:"version"`
	OSType             string   `json:"osType"`
	Arch               string   `json:"arch,omitempty"`
	IPAddress          string   `json:"ipAddress,omitempty"`
	ManagementEndpoint string   `json:"managementEndpoint,omitempty"`
	Labels             []string `json:"labels,omitempty"`
	EnrollmentToken    string   `json:"enrollmentToken,omitempty"`
	Role               string   `json:"role,omitempty"`
	Zone               string   `json:"zone,omitempty"`
	ZoneIDs            []string `json:"zoneIds,omitempty"`
	Adapters           []string `json:"adapters,omitempty"`
	Capabilities       []string `json:"capabilities,omitempty"`
}

type registerResponse struct {
	ID string `json:"id"`
}

type heartbeatRequest struct {
	AgentID            string   `json:"agentId"`
	Version            string   `json:"version"`
	ManagementEndpoint string   `json:"managementEndpoint,omitempty"`
	Adapters           []string `json:"adapters,omitempty"`
	Capabilities       []string `json:"capabilities,omitempty"`
}

type capabilityReportRequest struct {
	AgentID            string               `json:"agentId"`
	CompatibilityLevel string               `json:"compatibilityLevel,omitempty"`
	Capabilities       []reportedCapability `json:"capabilities"`
	Adapters           []string             `json:"adapters,omitempty"`
}

type reportedCapability struct {
	CapabilityKey string         `json:"capabilityKey"`
	Value         any            `json:"value"`
	Confidence    float64        `json:"confidence"`
	Evidence      map[string]any `json:"evidence,omitempty"`
}

type runtimeState struct {
	AgentID  string
	Hostname string
	Version  string
}

// ---- 控制面 HTTP 客户端 ----

func doJSONRequest(ctx context.Context, client *http.Client, config *AgentConfig, method string, endpointPath string, payload any, target any) error {
	baseURL := strings.TrimRight(strings.TrimSpace(config.ControlPlane), "/")
	if baseURL == "" {
		return errors.New("controlPlaneUrl 不能为空")
	}
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("编码请求失败: %w", err)
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, baseURL+endpointPath, body)
	if err != nil {
		return fmt.Errorf("创建请求失败: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Request-Id", fmt.Sprintf("gateway_agent_%d", time.Now().UnixNano()))
	if tenantID := strings.TrimSpace(config.TenantID); tenantID != "" {
		request.Header.Set("X-Tenant-Id", tenantID)
	}
	if token := strings.TrimSpace(config.EnrollmentToken); token != "" {
		request.Header.Set("X-Agent-Token", token)
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("请求控制面失败: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return fmt.Errorf("读取响应失败: %w", err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		var apiErr struct {
			Message   string `json:"message"`
			ErrorCode string `json:"errorCode"`
		}
		if err := json.Unmarshal(responseBody, &apiErr); err == nil && strings.TrimSpace(apiErr.Message) != "" {
			if strings.TrimSpace(apiErr.ErrorCode) != "" {
				return fmt.Errorf("%s (%s)", apiErr.Message, apiErr.ErrorCode)
			}
			return errors.New(apiErr.Message)
		}
		return fmt.Errorf("HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	if target == nil || len(bytes.TrimSpace(responseBody)) == 0 {
		return nil
	}
	var wrapped struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(responseBody, &wrapped); err == nil && len(wrapped.Data) > 0 {
		if err := json.Unmarshal(wrapped.Data, target); err == nil {
			return nil
		}
	}
	if err := json.Unmarshal(responseBody, target); err != nil {
		return fmt.Errorf("解析响应失败: %s", strings.TrimSpace(string(responseBody)))
	}
	return nil
}

// ---- 注册 / 心跳 / 能力上报 ----

func registerAgent(ctx context.Context, client *http.Client, config *AgentConfig, identity gatewayIdentity) (*runtimeState, error) {
	hostname := identity.Hostname
	if hostname == "" {
		hostname, _ = os.Hostname()
	}
	zone := strings.TrimSpace(config.Zone)
	if zone == "" {
		zone = "default"
	}
	request := registerRequest{
		AgentKey:           config.AgentKey,
		MachineID:          identity.MachineID,
		Hostname:           hostname,
		Version:            agentVersion,
		OSType:             runtime.GOOS,
		Arch:               runtime.GOARCH,
		IPAddress:          identity.PrimaryIPAddress,
		ManagementEndpoint: managementEndpointForIdentity(identity, config),
		Labels:             []string{"gateway-agent"},
		EnrollmentToken:    strings.TrimSpace(config.EnrollmentToken),
		Role:               "gateway",
		Zone:               zone,
		ZoneIDs:            []string{zone},
		Adapters:           gatewayRouteChannels(),
		Capabilities:       gatewayCapabilityKeys(),
	}
	var response registerResponse
	if err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/register", request, &response); err != nil {
		return nil, fmt.Errorf("注册 Gateway Agent 失败: %w", err)
	}
	if strings.TrimSpace(response.ID) == "" {
		return nil, errors.New("注册 Gateway Agent 失败: 服务端未返回 agentId")
	}
	return &runtimeState{AgentID: response.ID, Hostname: hostname, Version: agentVersion}, nil
}

func postHeartbeat(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState) error {
	request := heartbeatRequest{AgentID: state.AgentID, Version: state.Version, Adapters: gatewayRouteChannels(), Capabilities: gatewayCapabilityKeys()}
	return doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/heartbeat", request, nil)
}

func reportGatewayCapabilities(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState) error {
	capabilities := make([]reportedCapability, 0, len(gatewayCapabilityKeys()))
	for _, capability := range gatewayCapabilityKeys() {
		capabilities = append(capabilities, reportedCapability{
			CapabilityKey: capability,
			Value:         true,
			Confidence:    0.95,
			Evidence:      map[string]any{"source": "gateway-role"},
		})
	}
	request := capabilityReportRequest{
		AgentID:            state.AgentID,
		CompatibilityLevel: "L1",
		Capabilities:       capabilities,
		Adapters:           gatewayRouteChannels(),
	}
	return doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/capabilities", request, nil)
}
