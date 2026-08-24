package main

import (
	"testing"
)

func TestDefaultHeartbeatAndDirectControlState(t *testing.T) {
	config := &AgentConfig{DirectControlEnabled: true}
	if actual := effectiveHeartbeatSeconds(config); actual != 10 {
		t.Fatalf("默认心跳周期错误，期望 10，实际 %d", actual)
	}
	state := newDirectControlState(config)
	if !state.Enabled || state.ListenAddress == "" {
		t.Fatalf("注册前未生成 Direct Control 端点：%+v", state)
	}
}

func TestBuildDirectDiscoveryPayloadWindowsKeepsEmptyIISHostHeader(t *testing.T) {
	identity := runtimeIdentity{
		PrimaryIPAddress: "10.0.0.10",
		AdapterSnapshot: windowsAdapterSnapshot{
			IIS: &windowsIISDetail{
				Installed: true,
				Sites: []windowsIISSite{{
					Name: "测试站点",
					Bindings: []windowsIISBinding{{
						Protocol:           "https",
						IPAddress:          "*",
						Port:               443,
						BindingInformation: "*:443:",
					}},
				}},
			},
		},
	}

	payload := buildDirectDiscoveryPayloadWindows(identity, directDiscoveryRequest{IncludeBindings: true})
	sites := payload["siteAssets"].([]map[string]any)
	if len(sites) != 1 {
		t.Fatalf("空 Host Header 的 HTTPS Binding 应保留，实际站点数量 %d", len(sites))
	}
	if sites[0]["port"] != 443 || sites[0]["bindingInformation"] != "*:443:" {
		t.Fatalf("IIS Binding 信息不完整：%+v", sites[0])
	}
	if sites[0]["hostHeader"] != "" {
		t.Fatalf("空 Host Header 不应伪造成站点名称：%+v", sites[0])
	}
	serviceAssets := payload["serviceAssets"].([]map[string]any)
	if serviceAssets[0]["address"] != "10.0.0.10" {
		t.Fatalf("通配绑定应回退到设备地址：%+v", serviceAssets[0])
	}
}

func TestFormatWindowsSystemVersion(t *testing.T) {
	tests := []struct {
		name     string
		detail   *windowsOSDetail
		expected string
	}{
		{
			name: "产品名称和发行版本",
			detail: &windowsOSDetail{
				ProductName:    "Windows Server 2022 Datacenter",
				DisplayVersion: "21H2",
				BuildRevision:  "20348.2849",
			},
			expected: "Windows Server 2022 Datacenter 21H2",
		},
		{
			name: "产品名称和构建版本",
			detail: &windowsOSDetail{
				ProductName:   "Windows Server 2008 R2 Enterprise",
				CurrentBuild:  "7601",
				BuildRevision: "7601.27277",
			},
			expected: "Windows Server 2008 R2 Enterprise (Build 7601.27277)",
		},
		{
			name:     "未探测到系统信息",
			detail:   nil,
			expected: "",
		},
	}

	for _, current := range tests {
		t.Run(current.name, func(t *testing.T) {
			actual := formatWindowsSystemVersion(current.detail)
			if actual != current.expected {
				t.Fatalf("系统版本不匹配，期望 %q，实际 %q", current.expected, actual)
			}
		})
	}
}
