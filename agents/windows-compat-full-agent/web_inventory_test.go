package main

import (
	"context"
	"testing"
)

func TestParseWindowsListeningPortsKeepsPIDFromNetstatAno(t *testing.T) {
	ports := parseWindowsListeningPorts([]byte("  TCP    0.0.0.0:8443      0.0.0.0:0      LISTENING       2160\r\n"))
	if len(ports) != 1 || ports[0]["port"] != 8443 || ports[0]["pid"] != 2160 {
		t.Fatalf("netstat 监听端口解析错误: %#v", ports)
	}
}

func TestWebInventoryFromFactEnvelopeOnlyUsesMatureScannerResult(t *testing.T) {
	provided := map[string]any{
		"scope":      fullWebDiscoveryScope,
		"frameworks": []map[string]any{{"frameworkType": "web.nginx"}},
		"sites":      []map[string]any{{"name": "nginx.example.test"}},
	}
	result := webInventoryFromFactEnvelope(map[string]any{
		"webInventory": provided,
		"facts": []map[string]any{{
			"kind": "tls_certificate",
			"path": "windows-tls://127.0.0.1/8443/default",
		}},
	})
	if result["frameworks"].([]map[string]any)[0]["frameworkType"] != "web.nginx" || result["sites"].([]map[string]any)[0]["name"] != "nginx.example.test" {
		t.Fatalf("成熟扫描器的 Web 库存被错误改写: %#v", result)
	}
}

func TestWebInventoryFromFactEnvelopeDoesNotRebuildFromFacts(t *testing.T) {
	result := webInventoryFromFactEnvelope(map[string]any{
		"facts": []map[string]any{{
			"kind":              "tls_certificate",
			"source":            "local-tls-handshake",
			"frameworkType":     "web.nginx",
			"sha256Fingerprint": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		}},
	})
	if len(result["frameworks"].([]map[string]any)) != 0 || len(result["sites"].([]map[string]any)) != 0 || len(result["certificateFiles"].([]map[string]any)) != 0 {
		t.Fatalf("TLS 或候选事实不应重建 Web 绑定: %#v", result)
	}
}

func TestRuntimeCapabilityReportDoesNotCarryWebInventory(t *testing.T) {
	capabilities := collectRuntimeCapabilityReports(runtimeIdentity{}, map[string]any{"processes": []map[string]any{}, "listeningPorts": []map[string]any{}})
	for _, capability := range capabilities {
		if capability.CapabilityKey == "web.inventory" {
			t.Fatalf("周期运行态上报不得携带 web.inventory: %#v", capabilities)
		}
	}
}

func TestFullWebCapabilityReportRequiresExplicitScope(t *testing.T) {
	withoutScope := collectCapabilityReportsWithInventory(runtimeIdentity{}, map[string]any{"frameworks": []map[string]any{}})
	if containsCapability(withoutScope, "web.inventory") {
		t.Fatalf("没有完整 scope 的库存不得成为 Web 快照: %#v", withoutScope)
	}
	withScope := collectCapabilityReportsWithInventory(runtimeIdentity{}, map[string]any{"scope": fullWebDiscoveryScope, "frameworks": []map[string]any{}})
	if !containsCapability(withScope, "web.inventory") {
		t.Fatalf("带完整 scope 的库存必须上报 Web 快照: %#v", withScope)
	}
}

func TestCollectAgentFactsRefreshesMatureInventory(t *testing.T) {
	request := agentV2Request{RefreshWebInventory: true, Services: []string{}}
	// 当前宿主不是 Windows，扫描器会返回空库存或只读失败告警；关键是完整发现
	// 始终只通过同一条成熟扫描器入口生成 webInventory。
	success, code, _, detail := collectAgentFacts(context.Background(), request)
	if !success || code != "" {
		t.Fatalf("完整发现采集失败: success=%v code=%s detail=%#v", success, code, detail)
	}
	factEnvelope := mapFromMap(detail, "factEnvelope")
	inventory := mapFromMap(factEnvelope, "webInventory")
	if inventory == nil || inventory["scope"] != fullWebDiscoveryScope || stringFromMap(mapFromMap(inventory, "diagnostics"), "scanner") != "windows-runtime-discovery" {
		t.Fatalf("完整发现没有使用成熟运行态扫描器: %#v", factEnvelope)
	}
}

func containsCapability(capabilities []reportedCapability, capabilityKey string) bool {
	for _, capability := range capabilities {
		if capability.CapabilityKey == capabilityKey {
			return true
		}
	}
	return false
}
