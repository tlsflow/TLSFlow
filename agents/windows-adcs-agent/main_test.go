package main

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestParseRegistryValue(t *testing.T) {
	output := "    Active    REG_SZ    Contoso Issuing CA\r\n"
	if actual := parseRegistryValue(output, "Active"); actual != "Contoso Issuing CA" {
		t.Fatalf("活动 CA 解析错误：%q", actual)
	}
}

func TestParseTemplateNames(t *testing.T) {
	output := "WebServer -- Web Server\r\nGCACWebServer -- GCAC Web Server\r\nCertUtil: -CATemplates command completed successfully.\r\n"
	expected := []string{"WebServer", "GCACWebServer"}
	if actual := parseTemplateNames(output); !reflect.DeepEqual(actual, expected) {
		t.Fatalf("模板解析错误：%v", actual)
	}
}

func TestParseRequestID(t *testing.T) {
	if actual := parseRequestID("RequestId: 184\r\nCertificate retrieved"); actual != "184" {
		t.Fatalf("Request ID 解析错误：%q", actual)
	}
}

func TestCertutilReason(t *testing.T) {
	if certutilReason("keyCompromise") != "1" || certutilReason("superseded") != "4" || certutilReason("unknown") != "0" {
		t.Fatal("吊销原因映射错误")
	}
}

func TestPayloadStringRejectsMissingField(t *testing.T) {
	if _, err := payloadString(map[string]any{}, "csrPem"); err == nil {
		t.Fatal("缺少任务字段时必须返回错误")
	}
}

func TestReadServerEventsDispatchesTaskWithoutPolling(t *testing.T) {
	input := strings.NewReader("event: connected\ndata: {\"nodeId\":\"node-1\"}\n\nevent: heartbeat\ndata: {}\n\nevent: task\ndata: {\"id\":\"task-1\",\"taskType\":\"health_check\"}\n\n")
	var events []string
	err := readServerEvents(context.Background(), input, func(event string, data []byte) error {
		events = append(events, event+":"+string(data))
		return nil
	})
	if err == nil || err.Error() != "EOF" {
		t.Fatalf("流结束时应返回 EOF，实际为：%v", err)
	}
	expected := []string{
		`connected:{"nodeId":"node-1"}`,
		`heartbeat:{}`,
		`task:{"id":"task-1","taskType":"health_check"}`,
	}
	if !reflect.DeepEqual(events, expected) {
		t.Fatalf("SSE 事件解析错误：%v", events)
	}
}

func TestDecodeCommandOutputUsesWindowsSimplifiedChineseCodePage(t *testing.T) {
	gbk := []byte{0xb2, 0xe2, 0xca, 0xd4}
	if actual := decodeCommandOutputWithCodePage(gbk, 936); actual != "测试" {
		t.Fatalf("CP936 输出解码错误：%q", actual)
	}
}
