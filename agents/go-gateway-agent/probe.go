package main

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// 网关探测：gateway.probe（tcp/http/tls 可达性）。
// 探测只做网络层检查，不解析目标应用协议。

func executeGatewayProbe(ctx context.Context, client *http.Client, config *AgentConfig, task agentTaskEnvelope, gatewayTask map[string]any, gatewayPayload map[string]any) (bool, string, string, map[string]any, bool) {
	channel := gatewayRouteChannel(gatewayTask, gatewayPayload)
	start := time.Now()
	var success bool
	var detail map[string]any
	var err error
	if channel == "probe.tls" {
		success, detail, err = probeTLSReachability(ctx, gatewayPayload)
	} else if channel == "probe.http" {
		success, detail, err = probeHTTPReachability(ctx, gatewayPayload)
	} else {
		success, detail, err = probeTCPReachability(ctx, gatewayTask, gatewayPayload)
	}
	detail["mode"] = "gateway.probe"
	detail["routeChannel"] = channel
	detail["taskId"] = task.ID
	detail["durationMs"] = time.Since(start).Milliseconds()
	if err != nil {
		recordGatewayReachability(ctx, client, config, gatewayTask, detail, "unreachable")
		return false, "GATEWAY_PROBE_FAILED", err.Error(), detail, true
	}
	recordGatewayReachability(ctx, client, config, gatewayTask, detail, "reachable")
	return success, "", "", detail, true
}

func probeTLSReachability(ctx context.Context, gatewayPayload map[string]any) (bool, map[string]any, error) {
	input := gatewayProbeInput(gatewayPayload)
	verification := mapFromMap(input, "certificateVerification")
	if stringFromMap(verification, "capabilityKey") != "certificate.verify" || stringFromMap(verification, "schemaVersion") != "1.0" {
		return false, map[string]any{}, errors.New("gateway.probe TLS 缺少 certificate.verify/v1 宿主能力输入")
	}
	host := stringFromMap(verification, "connectHost")
	port := intFromMap(verification, "port")
	serverName := stringFromMap(verification, "serverName")
	if host == "" || port <= 0 || serverName == "" {
		return false, map[string]any{"host": host, "port": port, "serverName": serverName}, errors.New("gateway.probe TLS 缺少连接地址、端口或 SNI")
	}
	dialer := &net.Dialer{Timeout: 8 * time.Second}
	connection, err := (&tls.Dialer{NetDialer: dialer, Config: &tls.Config{ServerName: serverName, InsecureSkipVerify: true, MinVersion: tls.VersionTLS12}}).DialContext(ctx, "tcp", net.JoinHostPort(host, fmt.Sprintf("%d", port)))
	if err != nil {
		return false, map[string]any{"host": host, "port": port, "serverName": serverName}, err
	}
	defer connection.Close()
	certificates := connection.(*tls.Conn).ConnectionState().PeerCertificates
	if len(certificates) == 0 {
		return false, map[string]any{"host": host, "port": port, "serverName": serverName}, errors.New("TLS 握手未返回远端证书")
	}
	certificate := certificates[0]
	if err := certificate.VerifyHostname(serverName); err != nil {
		return false, map[string]any{"host": host, "port": port, "serverName": serverName}, fmt.Errorf("TLS 证书域名不匹配: %w", err)
	}
	fingerprint := fmt.Sprintf("%x", sha256.Sum256(certificate.Raw))
	return true, map[string]any{
		"verify": map[string]any{
			"remoteCertificateSha256": fingerprint,
			"subject":                 certificate.Subject.String(),
			"notAfter":                certificate.NotAfter.UTC().Format(time.RFC3339),
		},
		"certificateVerification": map[string]any{
			"capabilityKey": "certificate.verify",
			"schemaVersion": "1.0",
			"source":        "GATEWAY",
		},
	}, nil
}

func probeTCPReachability(ctx context.Context, gatewayTask map[string]any, gatewayPayload map[string]any) (bool, map[string]any, error) {
	host, port := gatewayProbeHostPort(gatewayTask, gatewayPayload)
	if host == "" || port <= 0 {
		return false, map[string]any{"host": host, "port": port}, errors.New("gateway.probe 缺少 host/port")
	}
	dialer := net.Dialer{Timeout: 5 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, fmt.Sprintf("%d", port)))
	if err != nil {
		return false, map[string]any{"host": host, "port": port}, err
	}
	_ = conn.Close()
	return true, map[string]any{"host": host, "port": port}, nil
}

func probeHTTPReachability(ctx context.Context, gatewayPayload map[string]any) (bool, map[string]any, error) {
	targetURL := gatewayProbeURL(gatewayPayload)
	if targetURL == "" {
		return false, map[string]any{}, errors.New("gateway.probe HTTP 缺少 url/verifyUrl")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, targetURL, nil)
	if err != nil {
		return false, map[string]any{"url": targetURL}, err
	}
	response, err := (&http.Client{Timeout: 8 * time.Second}).Do(request)
	if err != nil {
		request.Method = http.MethodGet
		response, err = (&http.Client{Timeout: 8 * time.Second}).Do(request)
	}
	if err != nil {
		return false, map[string]any{"url": targetURL}, err
	}
	defer response.Body.Close()
	return response.StatusCode < 500, map[string]any{"url": targetURL, "statusCode": response.StatusCode}, nil
}

func gatewayRouteChannel(gatewayTask map[string]any, gatewayPayload map[string]any) string {
	channel := strings.ToLower(firstNonEmpty(stringFromMap(gatewayTask, "adapter"), stringFromMap(gatewayPayload, "routeChannel")))
	switch channel {
	case "http", "https", "curl", "probe.http":
		return "probe.http"
	case "probe.tls":
		return "probe.tls"
	case "forward.agent_task", "gateway.forward.agent_task", "agent_task":
		return gatewayAdapterAgentTask
	default:
		return "probe.tcp"
	}
}

func gatewayProbeHostPort(gatewayTask map[string]any, gatewayPayload map[string]any) (string, int) {
	gatewayPayload = gatewayProbeInput(gatewayPayload)
	target := mapFromMap(gatewayTask, "target")
	host := firstNonEmpty(stringFromMap(gatewayPayload, "host"), stringFromMap(target, "host"))
	port := intFromMap(gatewayPayload, "port")
	if port == 0 {
		port = intFromMap(target, "port")
	}
	if host == "" {
		if parsed, err := url.Parse(gatewayProbeURL(gatewayPayload)); err == nil {
			host = parsed.Hostname()
			if parsed.Port() != "" {
				fmt.Sscanf(parsed.Port(), "%d", &port)
			}
		}
	}
	if port == 0 {
		port = 443
	}
	return host, port
}

func gatewayProbeInput(gatewayPayload map[string]any) map[string]any {
	if targetPayload := mapFromMap(gatewayPayload, "targetPayload"); targetPayload != nil {
		return targetPayload
	}
	return gatewayPayload
}

func gatewayProbeURL(gatewayPayload map[string]any) string {
	return firstNonEmpty(stringFromMap(gatewayPayload, "url"), stringFromMap(gatewayPayload, "verifyUrl"))
}

func recordGatewayReachability(ctx context.Context, client *http.Client, config *AgentConfig, gatewayTask map[string]any, detail map[string]any, status string) {
	gatewayID := firstNonEmpty(stringFromMap(gatewayTask, "gatewayId"), stringFromMap(gatewayTask, "id"))
	targetID := firstNonEmpty(stringFromMap(gatewayTask, "delegatedTargetId"), stringFromMap(mapFromMap(gatewayTask, "target"), "id"))
	if gatewayID == "" || targetID == "" {
		return
	}
	_ = doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/gateways/probe", map[string]any{
		"gatewayId":  gatewayID,
		"targetId":   targetID,
		"protocol":   detail["routeChannel"],
		"port":       detail["port"],
		"status":     status,
		"latencyMs":  detail["durationMs"],
		"ttlSeconds": 300,
	}, nil)
}

// ---- map 工具 ----

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func stringFromMap(input map[string]any, key string) string {
	if input == nil {
		return ""
	}
	return stringFromAny(input[key])
}

func mapFromMap(input map[string]any, key string) map[string]any {
	if input == nil {
		return nil
	}
	typed, _ := input[key].(map[string]any)
	return typed
}

func intFromMap(input map[string]any, key string) int {
	if input == nil {
		return 0
	}
	switch value := input[key].(type) {
	case int:
		return value
	case float64:
		return int(value)
	case json.Number:
		parsed, _ := value.Int64()
		return int(parsed)
	default:
		return 0
	}
}

func boolFromMap(input map[string]any, key string) bool {
	if input == nil {
		return false
	}
	value, _ := input[key].(bool)
	return value
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return ""
	}
}

func cloneMap(source map[string]any) map[string]any {
	target := make(map[string]any, len(source)+1)
	for key, value := range source {
		target[key] = value
	}
	return target
}
