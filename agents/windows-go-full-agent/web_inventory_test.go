package main

import (
	"encoding/base64"
	"testing"
)

func TestDecodeWindowsConfigTextDecodesUTF16LE(t *testing.T) {
	text, ok := decodeWindowsConfigText([]byte{0xff, 0xfe, '<', 0x00, 'x', 0x00, '>', 0x00})
	if !ok {
		t.Fatal("UTF-16 LE 配置应可解码")
	}
	if text != "<x>" {
		t.Fatalf("UTF-16 LE 解码结果错误: %q", text)
	}
}

func TestDecodeWindowsConfigTextRejectsRawNulBytes(t *testing.T) {
	if _, ok := decodeWindowsConfigText([]byte{'<', 0x00, 'x'}); ok {
		t.Fatal("没有 BOM 的含 NUL 内容必须视为非文本配置")
	}
}

func TestWebInventoryFromFactEnvelopeConvertsConfigFacts(t *testing.T) {
	iis := `<configuration><system.applicationHost><sites><site name="Default Web Site"><bindings><binding protocol="https" bindingInformation="*:443:portal.example.test" /></bindings></site></sites></system.applicationHost></configuration>`
	inventory := webInventoryFromFactEnvelope(map[string]any{"facts": []map[string]any{{
		"kind": "file_content", "path": `C:\Windows\System32\inetsrv\config\applicationHost.config`,
		"contentBase64": base64.StdEncoding.EncodeToString([]byte(iis)),
	}, {
		"kind": "listening_port", "address": "0.0.0.0", "port": 443, "protocol": "tcp",
	}}})
	frameworks := inventory["frameworks"].([]map[string]any)
	sites := inventory["sites"].([]map[string]any)
	if len(frameworks) != 1 || frameworks[0]["frameworkType"] != "web.iis" {
		t.Fatalf("IIS 事实未转换为框架: %#v", frameworks)
	}
	if len(sites) != 1 || sites[0]["name"] != "Default Web Site" || sites[0]["protocol"] != "HTTPS" {
		t.Fatalf("IIS 事实未转换为站点: %#v", sites)
	}
	if len(inventory["configFiles"].([]map[string]any)) != 1 || len(inventory["listeningPorts"].([]map[string]any)) != 1 {
		t.Fatalf("事实中的配置或监听端口未保留: %#v", inventory)
	}
}
