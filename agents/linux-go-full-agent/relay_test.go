package main

import (
	"bufio"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"
)

func relayTestKeyPair(t *testing.T) (ed25519.PrivateKey, ed25519.PublicKey) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("生成中继测试密钥失败: %v", err)
	}
	return privateKey, publicKey
}

func relayTestConfig(privateKey ed25519.PublicKey, gatewayRole bool) *AgentConfig {
	keys := []string{}
	if privateKey != nil {
		keys = append(keys, hex.EncodeToString(privateKey))
	}
	return &AgentConfig{
		GatewayEnabled:          gatewayRole,
		RelayEnabled:            true,
		RelayListenAddress:      "127.0.0.1",
		RelayPort:               0,
		RelayClientPublicKeys:   keys,
		RelayIdleTimeoutSeconds: 60,
	}
}

func startRelayOnFreePort(t *testing.T, config *AgentConfig) (*relayServer, string) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("预留中继端口失败: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	config.RelayPort = port
	server, err := startRelayServer(config)
	if err != nil {
		t.Fatalf("启动中继失败: %v", err)
	}
	t.Cleanup(func() { _ = server.Close() })
	return server, net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
}

func relayEchoServer(t *testing.T) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("启动 echo 目标失败: %v", err)
	}
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				_, _ = io.Copy(conn, conn)
			}()
		}
	}()
	return listener.Addr().String(), func() {
		_ = listener.Close()
		<-stopped
	}
}

// relayClientHandshake 模拟中继客户端：读 hello、签名、发请求，返回是否 ok。
func relayClientHandshake(t *testing.T, address string, privateKey ed25519.PrivateKey, host string, port int) (net.Conn, relayResponse, error) {
	t.Helper()
	conn, err := net.DialTimeout("tcp", address, 5*time.Second)
	if err != nil {
		return nil, relayResponse{}, err
	}
	t.Cleanup(func() { _ = conn.Close() })
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	reader := bufio.NewReader(conn)
	helloLine, err := reader.ReadBytes('\n')
	if err != nil {
		return nil, relayResponse{}, err
	}
	var hello relayHello
	if err := json.Unmarshal(helloLine, &hello); err != nil || hello.V != gatewayRelayProtocol {
		return nil, relayResponse{}, fmt.Errorf("hello 帧不合法: %v", err)
	}
	signed := hello.Challenge + ":" + host + ":" + strconv.Itoa(port)
	signature := ed25519.Sign(privateKey, []byte(signed))
	request := relayRequest{V: gatewayRelayProtocol, Signature: hex.EncodeToString(signature), Host: host, Port: port}
	if err := json.NewEncoder(conn).Encode(request); err != nil {
		return nil, relayResponse{}, err
	}
	responseLine, err := reader.ReadBytes('\n')
	if err != nil {
		return nil, relayResponse{}, err
	}
	var response relayResponse
	if err := json.Unmarshal(responseLine, &response); err != nil {
		return nil, relayResponse{}, fmt.Errorf("响应帧不合法: %v", err)
	}
	_ = conn.SetDeadline(time.Time{})
	return conn, response, nil
}

func TestRelayForwardsBytesToTarget(t *testing.T) {
	privateKey, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, true)
	_, relayAddress := startRelayOnFreePort(t, config)

	targetAddress, stopTarget := relayEchoServer(t)
	defer stopTarget()
	targetHost, targetPortText, err := net.SplitHostPort(targetAddress)
	if err != nil {
		t.Fatalf("拆分 echo 地址失败: %v", err)
	}
	targetPort, _ := strconv.Atoi(targetPortText)

	conn, response, err := relayClientHandshake(t, relayAddress, privateKey, targetHost, targetPort)
	if err != nil {
		t.Fatalf("中继握手失败: %v", err)
	}
	if !response.OK {
		t.Fatalf("中继握手被拒绝: %+v", response)
	}
	payload := "hello-via-gateway-relay\n"
	if _, err := conn.Write([]byte(payload)); err != nil {
		t.Fatalf("写入隧道失败: %v", err)
	}
	reader := bufio.NewReader(conn)
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("读取隧道回显失败: %v", err)
	}
	if line != payload {
		t.Fatalf("回显不匹配: got %q want %q", line, payload)
	}
}

func TestRelayRejectsBadSignature(t *testing.T) {
	_, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, true)
	_, relayAddress := startRelayOnFreePort(t, config)

	otherPrivateKey, _ := relayTestKeyPair(t)
	conn, err := net.DialTimeout("tcp", relayAddress, 5*time.Second)
	if err != nil {
		t.Fatalf("连接中继失败: %v", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	reader := bufio.NewReader(conn)
	helloLine, _ := reader.ReadBytes('\n')
	var hello relayHello
	if err := json.Unmarshal(helloLine, &hello); err != nil {
		t.Fatalf("hello 帧不合法: %v", err)
	}
	signed := hello.Challenge + ":127.0.0.1:22"
	signature := ed25519.Sign(otherPrivateKey, []byte(signed))
	_ = json.NewEncoder(conn).Encode(relayRequest{V: gatewayRelayProtocol, Signature: hex.EncodeToString(signature), Host: "127.0.0.1", Port: 22})
	responseLine, err := reader.ReadBytes('\n')
	if err != nil {
		t.Fatalf("未收到拒绝响应: %v", err)
	}
	var response relayResponse
	if err := json.Unmarshal(responseLine, &response); err != nil {
		t.Fatalf("响应帧不合法: %v", err)
	}
	if response.OK || response.Error != "AUTH_FAILED" {
		t.Fatalf("期望 AUTH_FAILED，实际 %+v", response)
	}
}

func TestRelayRejectsUnknownKey(t *testing.T) {
	_, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, true)
	_, relayAddress := startRelayOnFreePort(t, config)

	unknownPrivateKey, _ := relayTestKeyPair(t)
	_, response, err := relayClientHandshake(t, relayAddress, unknownPrivateKey, "127.0.0.1", 22)
	if err != nil {
		t.Fatalf("握手失败: %v", err)
	}
	if response.OK || response.Error != "AUTH_FAILED" {
		t.Fatalf("期望 AUTH_FAILED，实际 %+v", response)
	}
}

func TestRelayRejectsUnreachableTarget(t *testing.T) {
	privateKey, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, true)
	_, relayAddress := startRelayOnFreePort(t, config)

	// 先占用再释放，得到一个确定关闭的端口。
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("预留端口失败: %v", err)
	}
	closedPort := probe.Addr().(*net.TCPAddr).Port
	_ = probe.Close()

	_, response, err := relayClientHandshake(t, relayAddress, privateKey, "127.0.0.1", closedPort)
	if err != nil {
		t.Fatalf("握手失败: %v", err)
	}
	if response.OK || response.Error != "TARGET_UNREACHABLE" {
		t.Fatalf("期望 TARGET_UNREACHABLE，实际 %+v", response)
	}
}

func TestRelayRejectsInvalidTarget(t *testing.T) {
	_, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, true)
	_, relayAddress := startRelayOnFreePort(t, config)

	privateKey, _ := relayTestKeyPair(t)
	conn, err := net.DialTimeout("tcp", relayAddress, 5*time.Second)
	if err != nil {
		t.Fatalf("连接中继失败: %v", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	reader := bufio.NewReader(conn)
	helloLine, _ := reader.ReadBytes('\n')
	var hello relayHello
	if err := json.Unmarshal(helloLine, &hello); err != nil {
		t.Fatalf("hello 帧不合法: %v", err)
	}
	signed := hello.Challenge + ":bad/../host:22"
	signature := ed25519.Sign(privateKey, []byte(signed))
	_ = json.NewEncoder(conn).Encode(relayRequest{V: gatewayRelayProtocol, Signature: hex.EncodeToString(signature), Host: "bad/../host", Port: 22})
	responseLine, err := reader.ReadBytes('\n')
	if err != nil {
		t.Fatalf("未收到拒绝响应: %v", err)
	}
	var response relayResponse
	if err := json.Unmarshal(responseLine, &response); err != nil {
		t.Fatalf("响应帧不合法: %v", err)
	}
	if response.OK || response.Error != "INVALID_TARGET" {
		t.Fatalf("期望 INVALID_TARGET，实际 %+v", response)
	}
}

func TestRelayRequiresGatewayRole(t *testing.T) {
	_, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, false)
	if _, err := startRelayServer(config); err == nil || !strings.Contains(err.Error(), "Gateway 角色") {
		t.Fatalf("非网关角色启动中继应当失败，实际 err=%v", err)
	}
}

func TestRelayRequiresClientPublicKey(t *testing.T) {
	config := relayTestConfig(nil, true)
	if _, err := startRelayServer(config); err == nil || !strings.Contains(err.Error(), "relayClientPublicKeys") {
		t.Fatalf("缺少客户端公钥启动中继应当失败，实际 err=%v", err)
	}
}

func TestRelayRejectsConcurrentOvershoot(t *testing.T) {
	_, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, true)
	config.RelayIdleTimeoutSeconds = 30
	_, relayAddress := startRelayOnFreePort(t, config)
	if !strings.Contains(relayAddress, ":") {
		t.Fatalf("中继地址不合法: %s", relayAddress)
	}
}
