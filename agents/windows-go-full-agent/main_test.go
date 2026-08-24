package main

import "testing"

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
