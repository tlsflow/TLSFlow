package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestManagementServerExposesHealthAndDirectDiscoveryOnly(t *testing.T) {
	port := freeTCPPort(t)
	config := &AgentConfig{ManagementListenAddress: "127.0.0.1", ManagementPort: port}
	server, _, err := startManagementServer(config, runtimeIdentity{PrimaryIPAddress: "127.0.0.1"}, func(_ context.Context, payload map[string]any) directDiscoveryResponse {
		if payload["actionType"] != agentFactCollect {
			return directDiscoveryResponse{ErrorCode: "AGENT_DIRECT_DISCOVERY_INVALID"}
		}
		return directDiscoveryResponse{Success: true, Detail: map[string]any{"accepted": true}}
	})
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

	discovery, err := client.Post(
		fmt.Sprintf("http://127.0.0.1:%d/api/v1/control/discovery", port),
		"application/json",
		bytes.NewBufferString(`{"actionType":"agent.fact.collect","refreshWebInventory":true}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer discovery.Body.Close()
	var directResult directDiscoveryResponse
	if err := json.NewDecoder(discovery.Body).Decode(&directResult); err != nil {
		t.Fatal(err)
	}
	if discovery.StatusCode != http.StatusOK || !directResult.Success {
		t.Fatalf("直接重新发现响应异常 status=%d result=%+v", discovery.StatusCode, directResult)
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

func TestManagementServerUpgradeRequiresUpgradeHandler(t *testing.T) {
	port := freeTCPPort(t)
	config := &AgentConfig{ManagementListenAddress: "127.0.0.1", ManagementPort: port}
	server, _, err := startManagementServer(config, runtimeIdentity{PrimaryIPAddress: "127.0.0.1"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Shutdown(context.Background())

	client := &http.Client{Timeout: time.Second}
	var response *http.Response
	for attempt := 0; attempt < 20; attempt++ {
		response, err = client.Post(fmt.Sprintf("http://127.0.0.1:%d/api/v1/control/upgrade", port), "application/json", bytes.NewBufferString(`{"schemaVersion":"management.upgrade.v1"}`))
		if err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("未装配升级处理器时必须失败关闭 status=%d", response.StatusCode)
	}
}

func TestDirectDiscoveryControllerDoesNotBlockConcurrentScan(t *testing.T) {
	controller := &directDiscoveryController{}
	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan directDiscoveryResponse, 1)
	go func() {
		done <- controller.execute(context.Background(), func(context.Context) directDiscoveryResponse {
			close(started)
			<-release
			return directDiscoveryResponse{Success: true}
		})
	}()
	<-started
	second := controller.execute(context.Background(), func(context.Context) directDiscoveryResponse {
		t.Fatal("并发扫描不应启动第二个执行实例")
		return directDiscoveryResponse{Success: true}
	})
	if second.ErrorCode != "AGENT_DIRECT_DISCOVERY_IN_PROGRESS" {
		t.Fatalf("并发扫描必须明确返回进行中: %+v", second)
	}
	close(release)
	if first := <-done; !first.Success {
		t.Fatalf("首个扫描应成功: %+v", first)
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
