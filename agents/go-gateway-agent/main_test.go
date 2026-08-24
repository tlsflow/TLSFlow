package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGatewayConfigDefaultsAndSchema(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "agent.config.json")
	template, err := os.ReadFile("config/agent.config.template.json")
	if err != nil {
		t.Fatalf("读取模板失败: %v", err)
	}
	if err := os.WriteFile(configPath, template, 0o600); err != nil {
		t.Fatalf("写配置失败: %v", err)
	}
	config, err := loadConfig(configPath)
	if err != nil {
		t.Fatalf("加载配置失败: %v", err)
	}
	if config.SchemaVersion != gatewayConfigSchema {
		t.Fatalf("schema 不匹配: %s", config.SchemaVersion)
	}
	if effectiveManagementPort(config) != 18935 {
		t.Fatalf("网关管理端口应为 18935，实际 %d", effectiveManagementPort(config))
	}
	if effectiveRelayPort(config) != 18934 {
		t.Fatalf("网关中继端口应为 18934，实际 %d", effectiveRelayPort(config))
	}
	if effectiveRelayEnabled(config) {
		t.Fatalf("模板默认不应启用中继")
	}
	if got := gatewayRouteChannels(); len(got) != 1 || got[0] != gatewayRelayAdapter {
		t.Fatalf("Gateway 只能上报 relay.tcp 能力，实际 %v", got)
	}
	if got := gatewayCapabilityKeys(); len(got) != 1 || got[0] != gatewayRelayCapability {
		t.Fatalf("Gateway 只能上报 gateway.relay.tcp 能力，实际 %v", got)
	}
}

func TestGatewaySelfCheckFailsOnTemplateConfig(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "agent.config.json")
	template, _ := os.ReadFile("config/agent.config.template.json")
	_ = os.WriteFile(configPath, template, 0o600)
	checks := buildGatewaySelfChecks(configPath)
	for _, check := range checks {
		if check["key"] == "controlPlane.url" {
			if passed, _ := check["passed"].(bool); passed {
				t.Fatalf("模板占位 controlPlaneUrl 不应通过自检")
			}
		}
	}
}
