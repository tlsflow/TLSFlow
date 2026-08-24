package controlplane

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientDecodesWrappedResponseAndHeaders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("X-Tenant-Id") != "tenant-1" {
			t.Fatalf("租户 Header 未传递: %s", request.Header.Get("X-Tenant-Id"))
		}
		if request.Header.Get("X-Agent-Token") != "agent-token-1" {
			t.Fatalf("Agent Token 未传递")
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte("{\"data\":{\"id\":\"agent-1\"}}"))
	}))
	defer server.Close()

	client := New(server.Client(), Config{BaseURL: server.URL, TenantID: "tenant-1", AgentToken: "agent-token-1"})
	var target struct {
		ID string `json:"id"`
	}
	if err := client.DoJSON(context.Background(), http.MethodGet, "/agent", nil, &target); err != nil {
		t.Fatal(err)
	}
	if target.ID != "agent-1" {
		t.Fatalf("响应解析错误: %#v", target)
	}
}

func TestClientKeepsStableAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusForbidden)
		_, _ = writer.Write([]byte("{\"message\":\"forbidden\",\"errorCode\":\"AUTH_FORBIDDEN\"}"))
	}))
	defer server.Close()

	err := New(server.Client(), Config{BaseURL: server.URL}).DoJSON(context.Background(), http.MethodGet, "/agent", nil, nil)
	if err == nil || err.Error() != "forbidden (AUTH_FORBIDDEN)" {
		t.Fatalf("错误语义被破坏: %v", err)
	}
}
