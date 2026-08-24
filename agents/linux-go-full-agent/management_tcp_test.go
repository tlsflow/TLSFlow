package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestManagementServerExposesOnlyHealthEndpoints(t *testing.T) {
	port := freeTCPPort(t)
	config := &AgentConfig{ManagementListenAddress: "127.0.0.1", ManagementPort: port}
	server, _, err := startManagementServer(config, runtimeIdentity{PrimaryIPAddress: "127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Shutdown(context.Background())

	client := &http.Client{Timeout: time.Second}
	var health *http.Response
	for attempt := 0; attempt < 20; attempt++ {
		health, err = client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/control/health", port))
		if err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	body, readErr := io.ReadAll(health.Body)
	_ = health.Body.Close()
	if readErr != nil {
		t.Fatal(readErr)
	}
	if health.StatusCode != http.StatusOK || len(body) == 0 {
		t.Fatalf("健康端点响应异常 status=%d body=%s", health.StatusCode, body)
	}

	response, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/control/exec", port))
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("管理端口暴露了非健康接口 status=%d", response.StatusCode)
	}
}

func freeTCPPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}
