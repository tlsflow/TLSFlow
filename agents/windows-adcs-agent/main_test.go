package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestParseRegistryValue(t *testing.T) {
	output := "    Active    REG_SZ    Contoso Issuing CA\r\n"
	if actual := parseRegistryValue(output, "Active"); actual != "Contoso Issuing CA" {
		t.Fatalf("活动 CA 解析错误：%q", actual)
	}
}

func testIdentityKey(t *testing.T) ed25519.PrivateKey {
	t.Helper()
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return privateKey
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

func TestInspectAdcsViewRejectsUnboundedLimit(t *testing.T) {
	agent := &agent{}
	_, err := agent.inspectAdcsView(context.Background(), map[string]any{"limit": 21})
	if err == nil || !strings.Contains(err.Error(), "1 到 20") {
		t.Fatalf("expected bounded limit error, got %v", err)
	}
}

func TestNormalizeAdcsRecordPreservesConservativeDispositionMapping(t *testing.T) {
	issued, ok := normalizeAdcsRecord("request", map[string]any{
		"Request.RequestID": "20", "Request.Disposition": "20", "Request.DispositionMessage": "已颁发",
	})
	if !ok || issued["normalizedStatus"] != "issued" || issued["externalObjectId"] != "request:20" {
		t.Fatalf("已颁发记录规范化错误：%v", issued)
	}
	unknown, ok := normalizeAdcsRecord("request", map[string]any{
		"Request.RequestID": "15", "Request.Disposition": "15",
	})
	if !ok || unknown["normalizedStatus"] != "unknown" {
		t.Fatalf("未知 Disposition 不得误报成功：%v", unknown)
	}
	revoked, ok := normalizeAdcsRecord("revocation", map[string]any{
		"Request.RequestID": "21", "Request.RevokedWhen": "2026-07-24T12:00:00Z",
	})
	if !ok || revoked["normalizedStatus"] != "revoked" || revoked["externalObjectId"] != "revocation:21" {
		t.Fatalf("吊销记录规范化错误：%v", revoked)
	}
}

func TestAdcsSyncViewScriptUsesFixedProjectionAndRestriction(t *testing.T) {
	script := adcsSyncViewScript("request", []string{"Request.RequestID", "Request.Disposition"})
	for _, expected := range []string{"GetColumnIndex($false, $name)", "SetRestriction", "Request.RequestID", "GCAC_ADCS_LIMIT", "GCAC_ADCS_CHANGED_AFTER", "DateTimeOffset]::Parse($changedAfter)"} {
		if !strings.Contains(script, expected) {
			t.Fatalf("正式同步脚本缺少固定安全边界 %q", expected)
		}
	}
	if strings.Contains(script, "Invoke-Expression") || strings.Contains(script, "certutil.exe") {
		t.Fatal("分表 COM 查询脚本不得执行任意命令")
	}
}

func TestOpenAgentLogCreatesWritableFile(t *testing.T) {
	logFile, err := openAgentLog(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer logFile.Close()
	if _, err := logFile.WriteString("test\n"); err != nil {
		t.Fatal(err)
	}
}

func TestLeasePendingTaskIgnoresEmptyTask(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte("null"))
	}))
	defer server.Close()
	agent := &agent{
		config:     config{ControlPlaneURL: server.URL, TenantID: "tenant", NodeID: "node"},
		client:     &http.Client{Timeout: time.Second},
		privateKey: testIdentityKey(t),
	}
	if err := agent.leasePendingTask(context.Background()); err != nil {
		t.Fatal(err)
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
