package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"
)

// 独立 Gateway Agent（gcac-gateway-agent）
//
// 与普通 Full Agent 完全独立：独立二进制、独立配置 schema（gcac.gateway-agent.v1）、
// 独立端口（管理 18935 / 中继 18934）与独立安装路径（/opt/gcac/gateway 等）。
// 只承载网关职责：
//   - TCP 中继：私有密钥认证（ed25519 挑战应答）+ 网络层转发，不解析应用协议；
//   - 注册、心跳、能力上报和健康端口。
//
// 不包含 Full Agent 的本地计划执行、事实采集、Web 库存与证书操作。

const (
	gatewayConfigSchema    = "gcac.gateway-agent.v1"
	defaultManagementPort  = 18935
	defaultHeartbeat       = 10
	gatewayRelayAdapter    = "relay.tcp"
	gatewayRelayCapability = "gateway.relay.tcp"
)

var agentVersion = "0.1.0"

type AgentConfig struct {
	SchemaVersion           string                   `json:"schemaVersion"`
	TenantID                string                   `json:"tenantId"`
	AgentKey                string                   `json:"agentKey"`
	EnrollmentToken         string                   `json:"enrollmentToken"`
	Zone                    string                   `json:"zone"`
	ControlPlane            string                   `json:"controlPlaneUrl"`
	Heartbeat               int                      `json:"heartbeatIntervalSeconds"`
	ManagementListenAddress string                   `json:"managementListenAddress"`
	ManagementPort          int                      `json:"managementPort"`
	RelayEnabled            bool                     `json:"relayEnabled"`
	RelayListenAddress      string                   `json:"relayListenAddress"`
	RelayPort               int                      `json:"relayPort"`
	RelayClientPublicKeys   relayClientPublicKeyList `json:"relayClientPublicKeys"`
	RelayAllowedTargets     []string                 `json:"relayAllowedTargets"`
	RelayAllowedPorts       []int                    `json:"relayAllowedPorts"`
	RelayIdleTimeoutSeconds int                      `json:"relayIdleTimeoutSeconds"`
	Paths                   struct {
		Linux struct {
			ConfigPath string `json:"configPath"`
			DataDir    string `json:"dataDir"`
			LogDir     string `json:"logDir"`
		} `json:"linux"`
		Windows struct {
			ConfigPath string `json:"configPath"`
			DataDir    string `json:"dataDir"`
			LogDir     string `json:"logDir"`
		} `json:"windows"`
	} `json:"paths"`
	Service struct {
		Name        string `json:"name"`
		DisplayName string `json:"displayName"`
	} `json:"service"`
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "run":
		err = handleRun(os.Args[2:])
	case "service":
		// Windows 服务启动入口：service run 与 run 等价。
		if len(os.Args) >= 3 && os.Args[2] == "run" {
			err = handleRun(os.Args[3:])
		} else {
			usage()
			os.Exit(2)
		}
	case "self-check":
		err = handleSelfCheck(os.Args[2:])
	case "health":
		err = handleHealth(os.Args[2:])
	case "status":
		err = handleStatus(os.Args[2:])
	case "version":
		_ = writeJSON(map[string]any{"version": agentVersion, "goos": runtime.GOOS, "goarch": runtime.GOARCH, "schema": gatewayConfigSchema})
	case "help", "-h", "--help":
		usage()
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "错误：%v\n", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `GCAC Gateway Agent %s

用法：
  gcac-gateway-agent run --config=/etc/gcac/gateway/agent.config.json
  gcac-gateway-agent self-check --config=<path>
  gcac-gateway-agent health --config=<path>
  gcac-gateway-agent status --config=<path>
  gcac-gateway-agent version

Gateway Agent 独立于 Full Agent：只负责鉴权后的 TCP 直接转发。
`, agentVersion)
}

// 独立 Gateway Agent 恒为 gateway 角色。
func isGatewayEnabled(config *AgentConfig) bool {
	return true
}

func gatewayRouteChannels() []string {
	return []string{gatewayRelayAdapter}
}

func gatewayCapabilityKeys() []string {
	return []string{gatewayRelayCapability}
}

func loadConfig(path string) (*AgentConfig, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取配置失败: %w", err)
	}
	var config AgentConfig
	if err := json.Unmarshal(bytes, &config); err != nil {
		return nil, fmt.Errorf("解析配置失败: %w", err)
	}
	return &config, nil
}

func parseConfigPath(args []string) string {
	for i := 0; i < len(args); i++ {
		if args[i] == "--config" && i+1 < len(args) {
			return args[i+1]
		}
		if strings.HasPrefix(args[i], "--config=") {
			return strings.TrimPrefix(args[i], "--config=")
		}
	}
	if runtime.GOOS == "windows" {
		return `C:\ProgramData\GCAC\Gateway\config\agent.config.json`
	}
	return "/etc/gcac/gateway/agent.config.json"
}

func effectiveHeartbeatSeconds(config *AgentConfig) int {
	if config.Heartbeat > 0 {
		return config.Heartbeat
	}
	return defaultHeartbeat
}

func isValidControlPlaneURL(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return false
	}
	if strings.Contains(trimmed, "gcac.example.invalid") || strings.Contains(trimmed, "CHANGE_ME") {
		return false
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return false
	}
	return strings.TrimSpace(parsed.Scheme) != "" && strings.TrimSpace(parsed.Hostname()) != ""
}

func checkItem(key string, passed bool, detail map[string]any) map[string]any {
	item := map[string]any{"key": key, "passed": passed}
	for name, value := range detail {
		item[name] = value
	}
	return item
}

func allChecksPassed(checks []map[string]any) bool {
	for _, check := range checks {
		if passed, _ := check["passed"].(bool); !passed {
			return false
		}
	}
	return true
}

func writeJSON(value any) error {
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	_, err = fmt.Println(string(encoded))
	return err
}

func handleSelfCheck(args []string) error {
	configPath := parseConfigPath(args)
	checks := buildGatewaySelfChecks(configPath)
	return writeJSON(map[string]any{
		"success":   allChecksPassed(checks),
		"checkedAt": time.Now().Format(time.RFC3339),
		"checks":    checks,
	})
}

func buildGatewaySelfChecks(configPath string) []map[string]any {
	config, err := loadConfig(configPath)
	if err != nil {
		return []map[string]any{checkItem("config.load", false, map[string]any{"error": err.Error()})}
	}
	return []map[string]any{
		checkItem("config.exists", true, map[string]any{"configPath": configPath}),
		checkItem("config.schema", config.SchemaVersion == gatewayConfigSchema, map[string]any{"schemaVersion": config.SchemaVersion}),
		checkItem("service.name", strings.TrimSpace(config.Service.Name) != "", map[string]any{"serviceName": config.Service.Name}),
		checkItem("controlPlane.url", isValidControlPlaneURL(config.ControlPlane), map[string]any{"value": config.ControlPlane}),
		checkItem("agent.key", strings.TrimSpace(config.AgentKey) != "", map[string]any{"value": config.AgentKey}),
		checkItem("management.listen", managementListenAddressAvailable(config), map[string]any{"address": effectiveManagementListenAddress(config), "port": effectiveManagementPort(config)}),
		checkItem("relay.listen", relayListenAddressAvailable(config), map[string]any{"enabled": effectiveRelayEnabled(config), "address": effectiveRelayListenAddress(config), "port": effectiveRelayPort(config)}),
		checkItem("relay.client.key", !effectiveRelayEnabled(config) || len(relayClientPublicKeys(config)) > 0, map[string]any{"count": len(relayClientPublicKeys(config))}),
		checkItem("relay.target.policy", !effectiveRelayEnabled(config) || relayTargetPolicyConfigured(config), map[string]any{"targets": len(config.RelayAllowedTargets), "ports": len(config.RelayAllowedPorts)}),
	}
}

func handleHealth(args []string) error {
	return handleSelfCheck(args)
}

func handleStatus(args []string) error {
	configPath := parseConfigPath(args)
	config, err := loadConfig(configPath)
	if err != nil {
		return err
	}
	return writeJSON(map[string]any{
		"binaryVersion": agentVersion,
		"config": map[string]any{
			"path":            configPath,
			"schema":          config.SchemaVersion,
			"serviceName":     config.Service.Name,
			"controlPlaneUrl": config.ControlPlane,
			"zone":            config.Zone,
			"managementPort":  effectiveManagementPort(config),
			"relayEnabled":    effectiveRelayEnabled(config),
			"relayPort":       effectiveRelayPort(config),
		},
		"goos":   runtime.GOOS,
		"goarch": runtime.GOARCH,
	})
}

func handleRun(args []string) error {
	configPath := parseConfigPath(args)
	config, err := loadConfig(configPath)
	if err != nil {
		return err
	}
	if config.SchemaVersion != gatewayConfigSchema {
		return fmt.Errorf("配置 schemaVersion 必须是 %s", gatewayConfigSchema)
	}
	if !isValidControlPlaneURL(config.ControlPlane) {
		return errors.New("controlPlaneUrl 无效或仍是模板占位值，Gateway Agent 无法启动")
	}
	if strings.TrimSpace(config.AgentKey) == "" {
		return errors.New("agentKey 不能为空，Gateway Agent 无法启动")
	}
	if !effectiveRelayEnabled(config) {
		return errors.New("独立 Gateway Agent 必须启用 relayEnabled，禁止以无 Relay 模式启动")
	}
	if len(relayClientPublicKeys(config)) == 0 {
		return errors.New("TCP 中继已启用但未配置有效 relayClientPublicKeys")
	}
	if !relayTargetPolicyConfigured(config) {
		return errors.New("TCP 中继已启用但未配置 relayAllowedTargets/relayAllowedPorts")
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	client := &http.Client{Timeout: 15 * time.Second}
	identity := collectGatewayIdentity(config)
	state, err := registerAgent(ctx, client, config, identity)
	if err != nil {
		return err
	}

	managementServer, _, err := startManagementServer(config, identity)
	if err != nil {
		return err
	}
	defer managementServer.Shutdown(context.Background())

	relayServer, err := startRelayServer(config)
	if err != nil {
		return err
	}
	if relayServer != nil {
		defer relayServer.Close()
	}

	if err := postHeartbeat(ctx, client, config, state); err != nil {
		fmt.Fprintf(os.Stderr, "[heartbeat] first report failed: %v\n", err)
	} else {
		fmt.Fprintf(os.Stderr, "[heartbeat] first report ok agent=%s agentId=%s\n", config.AgentKey, state.AgentID)
	}
	if err := reportGatewayCapabilities(ctx, client, config, state); err != nil {
		fmt.Fprintf(os.Stderr, "[capabilities] first report failed: %v\n", err)
	}

	fmt.Fprintf(os.Stderr, "GCAC Gateway Agent running service=%s config=%s agentId=%s relay=%s\n",
		config.Service.Name, configPath, state.AgentID, relayEndpoint(config))

	heartbeatTicker := time.NewTicker(time.Duration(effectiveHeartbeatSeconds(config)) * time.Second)
	defer heartbeatTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			fmt.Fprintf(os.Stderr, "GCAC Gateway Agent stopped\n")
			return nil
		case <-heartbeatTicker.C:
			if err := postHeartbeat(ctx, client, config, state); err != nil {
				fmt.Fprintf(os.Stderr, "[heartbeat] %v\n", err)
			}
		}
	}
}

func relayEndpoint(config *AgentConfig) string {
	address := net.JoinHostPort(effectiveRelayListenAddress(config), fmt.Sprintf("%d", effectiveRelayPort(config)))
	if effectiveRelayEnabled(config) {
		return address
	}
	return "disabled"
}

func effectiveManagementListenAddress(config *AgentConfig) string {
	if value := strings.TrimSpace(config.ManagementListenAddress); value != "" {
		return value
	}
	return "0.0.0.0"
}

func effectiveManagementPort(config *AgentConfig) int {
	if config.ManagementPort > 0 && config.ManagementPort <= 65535 {
		return config.ManagementPort
	}
	return defaultManagementPort
}

func managementListenAddressAvailable(config *AgentConfig) bool {
	address := net.JoinHostPort(effectiveManagementListenAddress(config), fmt.Sprintf("%d", effectiveManagementPort(config)))
	response, probeErr := (&http.Client{Timeout: 500 * time.Millisecond}).Get("http://" + address + "/healthz")
	if probeErr == nil {
		_ = response.Body.Close()
		return response.StatusCode >= 200 && response.StatusCode < 500
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return false
	}
	_ = listener.Close()
	return true
}

// 管理监听只提供健康检查，让控制面 liveness 能探测网关本体。
func startManagementServer(config *AgentConfig, identity gatewayIdentity) (*http.Server, string, error) {
	listenAddress := net.JoinHostPort(effectiveManagementListenAddress(config), fmt.Sprintf("%d", effectiveManagementPort(config)))
	listener, err := net.Listen("tcp", listenAddress)
	if err != nil {
		return nil, "", fmt.Errorf("管理 TCP 监听启动失败 %s: %w", listenAddress, err)
	}
	server := &http.Server{
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      30 * time.Second,
		Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if request.Method == http.MethodGet && (request.URL.Path == "/api/v1/control/health" || request.URL.Path == "/healthz") {
				writer.Header().Set("Content-Type", "application/json")
				hostname, _ := os.Hostname()
				_ = json.NewEncoder(writer).Encode(map[string]any{
					"success": true, "status": "healthy", "agentVersion": agentVersion,
					"hostname": hostname, "managementEndpoint": managementEndpointForIdentity(identity, config),
				})
				return
			}
			http.Error(writer, "gateway management endpoint only supports health checks", http.StatusNotFound)
		}),
	}
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			fmt.Fprintf(os.Stderr, "[management] listener stopped: %v\n", serveErr)
		}
	}()
	return server, managementEndpointForIdentity(identity, config), nil
}

func managementEndpointForIdentity(identity gatewayIdentity, config *AgentConfig) string {
	host := strings.TrimSpace(identity.PrimaryIPAddress)
	if host == "" {
		host, _ = os.Hostname()
	}
	if host == "" {
		host = "127.0.0.1"
	}
	return fmt.Sprintf("http://%s", net.JoinHostPort(host, fmt.Sprintf("%d", effectiveManagementPort(config))))
}
