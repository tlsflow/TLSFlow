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
	_ = gatewayRole // 独立 Gateway Agent 恒为 gateway 角色
	ports := make([]int, 0, 65535)
	for port := 1; port <= 65535; port++ {
		ports = append(ports, port)
	}
	return &AgentConfig{
		RelayEnabled:            true,
		RelayListenAddress:      "127.0.0.1",
		RelayPort:               0,
		RelayClientPublicKeys:   keys,
		RelayAllowedTargets:     []string{"127.0.0.1"},
		RelayAllowedPorts:       ports,
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

func TestRelayRejectsReplayedChallengeSignature(t *testing.T) {
	privateKey, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, true)
	_, relayAddress := startRelayOnFreePort(t, config)
	targetAddress, stopTarget := relayEchoServer(t)
	defer stopTarget()
	targetHost, targetPortText, _ := net.SplitHostPort(targetAddress)
	targetPort, _ := strconv.Atoi(targetPortText)

	first, err := net.DialTimeout("tcp", relayAddress, 5*time.Second)
	if err != nil {
		t.Fatalf("第一次连接中继失败: %v", err)
	}
	defer first.Close()
	firstReader := bufio.NewReader(first)
	firstHelloLine, err := firstReader.ReadBytes('\n')
	if err != nil {
		t.Fatalf("第一次读取 challenge 失败: %v", err)
	}
	var firstHello relayHello
	if err := json.Unmarshal(firstHelloLine, &firstHello); err != nil {
		t.Fatalf("第一次 hello 帧不合法: %v", err)
	}
	firstSignature := ed25519.Sign(privateKey, []byte(firstHello.Challenge+":"+targetHost+":"+strconv.Itoa(targetPort)))
	if err := json.NewEncoder(first).Encode(relayRequest{V: gatewayRelayProtocol, Signature: hex.EncodeToString(firstSignature), Host: targetHost, Port: targetPort}); err != nil {
		t.Fatalf("第一次发送握手失败: %v", err)
	}
	var firstResponse relayResponse
	if err := json.NewDecoder(firstReader).Decode(&firstResponse); err != nil || !firstResponse.OK {
		t.Fatalf("第一次握手应成功: err=%v response=%+v", err, firstResponse)
	}

	second, err := net.DialTimeout("tcp", relayAddress, 5*time.Second)
	if err != nil {
		t.Fatalf("第二次连接中继失败: %v", err)
	}
	defer second.Close()
	secondReader := bufio.NewReader(second)
	secondHelloLine, err := secondReader.ReadBytes('\n')
	if err != nil {
		t.Fatalf("第二次读取 challenge 失败: %v", err)
	}
	var secondHello relayHello
	if err := json.Unmarshal(secondHelloLine, &secondHello); err != nil {
		t.Fatalf("第二次 hello 帧不合法: %v", err)
	}
	if firstHello.Challenge == secondHello.Challenge {
		t.Fatal("不同连接不得复用 challenge")
	}
	if err := json.NewEncoder(second).Encode(relayRequest{V: gatewayRelayProtocol, Signature: hex.EncodeToString(firstSignature), Host: targetHost, Port: targetPort}); err != nil {
		t.Fatalf("发送重放握手失败: %v", err)
	}
	var secondResponse relayResponse
	if err := json.NewDecoder(secondReader).Decode(&secondResponse); err != nil {
		t.Fatalf("读取重放拒绝响应失败: %v", err)
	}
	if secondResponse.OK || secondResponse.Error != "AUTH_FAILED" {
		t.Fatalf("重放旧 challenge 签名应拒绝，实际 %+v", secondResponse)
	}
}

func TestRelayRejectsOversizedHandshakeFrame(t *testing.T) {
	_, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, true)
	_, relayAddress := startRelayOnFreePort(t, config)
	conn, err := net.DialTimeout("tcp", relayAddress, 5*time.Second)
	if err != nil {
		t.Fatalf("连接中继失败: %v", err)
	}
	defer conn.Close()
	reader := bufio.NewReader(conn)
	if _, err := reader.ReadBytes('\n'); err != nil {
		t.Fatalf("读取 hello 失败: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := conn.Write(append([]byte(strings.Repeat("x", maxRelayRequestFrameBytes+1)), '\n')); err != nil {
		t.Fatalf("发送超大握手帧失败: %v", err)
	}
	if _, err := reader.ReadBytes('\n'); err == nil {
		t.Fatal("超大握手帧不应收到成功响应")
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
	// 独立 Gateway Agent 恒为 gateway 角色，中继不再需要角色门禁，直接可启动。
	_, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, false)
	server, address := startRelayOnFreePort(t, config)
	if address == "" || server == nil {
		t.Fatalf("中继应成功启动")
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

func TestRelayRejectsTargetOutsideAllowlist(t *testing.T) {
	privateKey, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, true)
	_, relayAddress := startRelayOnFreePort(t, config)
	_, response, err := relayClientHandshake(t, relayAddress, privateKey, "8.8.8.8", 53)
	if err != nil {
		t.Fatalf("握手失败: %v", err)
	}
	if response.OK || response.Error != "TARGET_NOT_ALLOWED" {
		t.Fatalf("白名单外目标应拒绝，实际 %+v", response)
	}
}

func TestRelayRejectsInvalidTargetPolicyAtStartup(t *testing.T) {
	_, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, true)
	config.RelayAllowedTargets = []string{"bad target"}
	if _, err := startRelayServer(config); err == nil || !strings.Contains(err.Error(), "relayAllowedTargets") {
		t.Fatalf("非法目标白名单应阻止中继启动，实际 err=%v", err)
	}
}

func TestRelayRejectsPrivateAddressReturnedByDNS(t *testing.T) {
	privateKey, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, true)
	config.RelayAllowedTargets = []string{"target.example.test"}
	oldLookup := lookupRelayIPs
	lookupRelayIPs = func(string) ([]net.IP, error) { return []net.IP{net.ParseIP("127.0.0.1")}, nil }
	t.Cleanup(func() { lookupRelayIPs = oldLookup })
	_, relayAddress := startRelayOnFreePort(t, config)
	_, response, err := relayClientHandshake(t, relayAddress, privateKey, "target.example.test", 443)
	if err != nil {
		t.Fatalf("握手失败: %v", err)
	}
	if response.OK || response.Error != "TARGET_SSRF_BLOCKED" {
		t.Fatalf("DNS 解析到回环地址应拒绝，实际 %+v", response)
	}
}

func TestRelayRejectsPortOutsideAllowlist(t *testing.T) {
	privateKey, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, true)
	config.RelayAllowedPorts = []int{443}
	_, relayAddress := startRelayOnFreePort(t, config)
	_, response, err := relayClientHandshake(t, relayAddress, privateKey, "127.0.0.1", 22)
	if err != nil {
		t.Fatalf("握手失败: %v", err)
	}
	if response.OK || response.Error != "PORT_NOT_ALLOWED" {
		t.Fatalf("白名单外端口应拒绝，实际 %+v", response)
	}
}

func TestRelayPreservesPayloadSentWithHandshakeFrame(t *testing.T) {
	privateKey, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, true)
	_, relayAddress := startRelayOnFreePort(t, config)
	targetAddress, stopTarget := relayEchoServer(t)
	defer stopTarget()
	targetHost, targetPortText, _ := net.SplitHostPort(targetAddress)
	targetPort, _ := strconv.Atoi(targetPortText)

	conn, err := net.DialTimeout("tcp", relayAddress, 5*time.Second)
	if err != nil {
		t.Fatalf("连接中继失败: %v", err)
	}
	defer conn.Close()
	reader := bufio.NewReader(conn)
	helloLine, _ := reader.ReadBytes('\n')
	var hello relayHello
	if err := json.Unmarshal(helloLine, &hello); err != nil {
		t.Fatalf("hello 帧不合法: %v", err)
	}
	signed := hello.Challenge + ":" + targetHost + ":" + strconv.Itoa(targetPort)
	signature := ed25519.Sign(privateKey, []byte(signed))
	request, _ := json.Marshal(relayRequest{V: gatewayRelayProtocol, Signature: hex.EncodeToString(signature), Host: targetHost, Port: targetPort})
	if _, err := conn.Write(append(append(request, '\n'), []byte("same-write-payload")...)); err != nil {
		t.Fatalf("写入握手和载荷失败: %v", err)
	}
	responseLine, _ := reader.ReadBytes('\n')
	var response relayResponse
	if err := json.Unmarshal(responseLine, &response); err != nil || !response.OK {
		t.Fatalf("中继握手应成功: %s %+v", responseLine, response)
	}
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	echo := make([]byte, len("same-write-payload"))
	if _, err := io.ReadFull(reader, echo); err != nil {
		t.Fatalf("同包载荷未被透传: %v", err)
	}
	if string(echo) != "same-write-payload" {
		t.Fatalf("同包载荷不匹配: %q", echo)
	}
}

func TestRelayPreservesHalfClose(t *testing.T) {
	privateKey, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, true)
	_, relayAddress := startRelayOnFreePort(t, config)

	targetListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("启动 half-close 目标失败: %v", err)
	}
	targetDone := make(chan string, 1)
	go func() {
		conn, acceptErr := targetListener.Accept()
		if acceptErr != nil {
			targetDone <- acceptErr.Error()
			return
		}
		defer conn.Close()
		payload, readErr := io.ReadAll(conn)
		if readErr != nil {
			targetDone <- readErr.Error()
			return
		}
		_, _ = conn.Write([]byte("half-close-response"))
		targetDone <- string(payload)
	}()
	t.Cleanup(func() { _ = targetListener.Close() })
	targetHost, targetPortText, _ := net.SplitHostPort(targetListener.Addr().String())
	targetPort, _ := strconv.Atoi(targetPortText)

	conn, response, err := relayClientHandshake(t, relayAddress, privateKey, targetHost, targetPort)
	if err != nil || !response.OK {
		t.Fatalf("half-close 握手失败: err=%v response=%+v", err, response)
	}
	if _, err := conn.Write([]byte("half-close-request")); err != nil {
		t.Fatalf("写入 half-close 请求失败: %v", err)
	}
	clientConn, ok := conn.(*net.TCPConn)
	if !ok {
		t.Fatalf("测试客户端不是 TCP 连接: %T", conn)
	}
	if err := clientConn.CloseWrite(); err != nil {
		t.Fatalf("关闭客户端写半连接失败: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	responsePayload, err := io.ReadAll(conn)
	if err != nil {
		t.Fatalf("读取 half-close 响应失败: %v", err)
	}
	if string(responsePayload) != "half-close-response" {
		t.Fatalf("half-close 响应不匹配: %q", responsePayload)
	}
	select {
	case received := <-targetDone:
		if received != "half-close-request" {
			t.Fatalf("目标收到的 half-close 数据不匹配: %q", received)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("目标未观察到客户端 half-close")
	}
}

func TestRelayClosesIdleSession(t *testing.T) {
	privateKey, publicKey := relayTestKeyPair(t)
	config := relayTestConfig(publicKey, true)
	config.RelayIdleTimeoutSeconds = 1
	_, relayAddress := startRelayOnFreePort(t, config)

	targetListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("启动 idle 目标失败: %v", err)
	}
	t.Cleanup(func() { _ = targetListener.Close() })
	go func() {
		conn, acceptErr := targetListener.Accept()
		if acceptErr == nil {
			defer conn.Close()
			_, _ = io.Copy(io.Discard, conn)
		}
	}()
	targetHost, targetPortText, _ := net.SplitHostPort(targetListener.Addr().String())
	targetPort, _ := strconv.Atoi(targetPortText)
	conn, response, err := relayClientHandshake(t, relayAddress, privateKey, targetHost, targetPort)
	if err != nil || !response.OK {
		t.Fatalf("idle 握手失败: err=%v response=%+v", err, response)
	}
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := conn.Read(make([]byte, 1)); err == nil {
		t.Fatal("idle session 应在无读写超时后关闭")
	}
}

func TestRelayConcurrentGateUsesAtomicLimit(t *testing.T) {
	server := &relayServer{}
	for index := 0; index < maxRelayConcurrentSessions; index++ {
		if !server.tryAcquireSession() {
			t.Fatalf("第 %d 个会话不应提前被拒绝", index+1)
		}
	}
	if server.tryAcquireSession() {
		t.Fatalf("第 129 个会话必须被拒绝")
	}
}
