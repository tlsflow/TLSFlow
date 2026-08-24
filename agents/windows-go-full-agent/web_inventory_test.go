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

func TestWebInventoryFromFactEnvelopeConvertsGenericFacts(t *testing.T) {
	iis := `<configuration><system.applicationHost><sites><site name="Default Web Site"><bindings><binding protocol="https" bindingInformation="*:443:portal.example.test" /></bindings></site></sites></system.applicationHost></configuration>`
	inventory := webInventoryFromFactEnvelope(map[string]any{"facts": []map[string]any{{
		"kind": "file_content", "path": `C:\Windows\System32\inetsrv\config\applicationHost.config`,
		"contentBase64": base64.StdEncoding.EncodeToString([]byte(iis)),
	}, {
		"kind": "listening_port", "address": "0.0.0.0", "port": 443, "protocol": "tcp",
	}}})
	if len(inventory["configFiles"].([]map[string]any)) != 1 || len(inventory["listeningPorts"].([]map[string]any)) != 1 {
		t.Fatalf("事实中的配置或监听端口未保留: %#v", inventory)
	}
	if len(inventory["frameworks"].([]map[string]any)) != 0 || len(inventory["sites"].([]map[string]any)) != 0 {
		t.Fatalf("Agent Core 不应硬编码产品解析: %#v", inventory)
	}
}

func TestWebInventoryFromFactEnvelopeConvertsWindowsCertificateStoreFacts(t *testing.T) {
	inventory := webInventoryFromFactEnvelope(map[string]any{"facts": []map[string]any{{
		"kind": "certificate_store", "store": "My", "storeLocation": "LocalMachine", "thumbprint": "a1 b2 c3 d4 e5 f6 07 08", "subject": "CN=portal.example.test",
	}}})
	certificates := inventory["certificateFiles"].([]map[string]any)
	if len(certificates) != 1 || certificates[0]["thumbprint"] != "A1B2C3D4E5F60708" {
		t.Fatalf("Windows 证书库事实未转换为通用证书文件: %#v", certificates)
	}
}
