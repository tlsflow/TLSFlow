package main

import (
	"bufio"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// 网关 TCP 中继（Gateway Relay）
//
// 只做网络层转发，不解析任何应用协议：
//   1. 客户端（控制面/运维工具）连接到网关中继端口；
//   2. 网关下发随机 challenge；
//   3. 客户端用私有密钥对 challenge+host+port 做 ed25519 签名；
//   4. 网关用配置的 relayClientPublicKeys 验证签名；
//   5. 验证通过后网关直连目标 host:port 并双向透传原始字节。
//
// 认证通过后允许转发到任意网关可达的 host:port（不做目标白名单），
// 这是有意保持的简化：网关只负责私有密钥认证 + TCP 转发。

const (
	gatewayRelayProtocol           = "gcac.gateway-relay/v1"
	defaultRelayPort               = 18934
	defaultRelayIdleTimeoutSeconds = 300
	relayHandshakeTimeout          = 10 * time.Second
	relayDialTimeout               = 8 * time.Second
	maxRelayConcurrentSessions     = 128
	maxRelayRequestFrameBytes      = 4 << 10
	relayIdleWatchdogGranularity   = 5 * time.Second
)

type relayHello struct {
	V         string `json:"v"`
	Challenge string `json:"challenge"`
	Session   string `json:"session"`
}

type relayRequest struct {
	V         string `json:"v"`
	Signature string `json:"sig"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
}

type relayResponse struct {
	OK      bool   `json:"ok"`
	Error   string `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
}

type relayServer struct {
	listener  net.Listener
	config    *AgentConfig
	closed    chan struct{}
	closeOnce sync.Once
	wg        sync.WaitGroup
	sessions  int64
}

func effectiveRelayEnabled(config *AgentConfig) bool {
	return config.RelayEnabled
}

func effectiveRelayListenAddress(config *AgentConfig) string {
	if value := strings.TrimSpace(config.RelayListenAddress); value != "" {
		return value
	}
	return "0.0.0.0"
}

func effectiveRelayPort(config *AgentConfig) int {
	if config.RelayPort > 0 && config.RelayPort <= 65535 {
		return config.RelayPort
	}
	return defaultRelayPort
}

func effectiveRelayIdleTimeout(config *AgentConfig) time.Duration {
	if config.RelayIdleTimeoutSeconds > 0 {
		return time.Duration(config.RelayIdleTimeoutSeconds) * time.Second
	}
	return time.Duration(defaultRelayIdleTimeoutSeconds) * time.Second
}

// relayClientPublicKeys 解析配置里的 ed25519 公钥（hex）；非法条目直接忽略。
func relayClientPublicKeys(config *AgentConfig) []ed25519.PublicKey {
	keys := make([]ed25519.PublicKey, 0, len(config.RelayClientPublicKeys))
	for _, raw := range config.RelayClientPublicKeys {
		decoded, err := hex.DecodeString(strings.TrimSpace(raw))
		if err != nil || len(decoded) != ed25519.PublicKeySize {
			continue
		}
		keys = append(keys, ed25519.PublicKey(decoded))
	}
	return keys
}

// relayClientPublicKeyList 兼容字符串与数组两种 JSON 形式。
// PowerShell 5.1 的 ConvertTo-Json 会把单元素数组序列化成标量，
// 这里显式接受这两种形式，避免安装脚本受序列化差异影响。
type relayClientPublicKeyList []string

func (keys *relayClientPublicKeyList) UnmarshalJSON(data []byte) error {
	var single string
	if err := json.Unmarshal(data, &single); err == nil && strings.TrimSpace(single) != "" {
		*keys = []string{single}
		return nil
	}
	var list []string
	if err := json.Unmarshal(data, &list); err != nil {
		return err
	}
	*keys = list
	return nil
}

// relayListenAddressAvailable 与 management 自检一致：验证端口确实可绑定。
func relayListenAddressAvailable(config *AgentConfig) bool {
	if !effectiveRelayEnabled(config) {
		return true
	}
	address := net.JoinHostPort(effectiveRelayListenAddress(config), fmt.Sprintf("%d", effectiveRelayPort(config)))
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return false
	}
	_ = listener.Close()
	return true
}

// startRelayServer 启动网关 TCP 中继；中继未启用时返回 (nil, nil)。
// 中继依赖 gateway 角色与至少一个客户端公钥，配置不满足时失败关闭。
func startRelayServer(config *AgentConfig) (*relayServer, error) {
	if !isGatewayEnabled(config) {
		return nil, errors.New("TCP 中继要求 Gateway 角色（gatewayEnabled=true）")
	}
	if !effectiveRelayEnabled(config) {
		return nil, nil
	}
	if len(relayClientPublicKeys(config)) == 0 {
		return nil, errors.New("TCP 中继已启用但未配置 relayClientPublicKeys")
	}
	address := net.JoinHostPort(effectiveRelayListenAddress(config), fmt.Sprintf("%d", effectiveRelayPort(config)))
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return nil, fmt.Errorf("TCP 中继监听启动失败 %s: %w", address, err)
	}
	server := &relayServer{
		listener: listener,
		config:   config,
		closed:   make(chan struct{}),
	}
	go server.acceptLoop()
	fmt.Fprintf(os.Stderr, "[relay] listening on %s\n", address)
	return server, nil
}

func (server *relayServer) acceptLoop() {
	for {
		conn, err := server.listener.Accept()
		if err != nil {
			select {
			case <-server.closed:
				return
			default:
				continue
			}
		}
		if atomic.LoadInt64(&server.sessions) >= maxRelayConcurrentSessions {
			_ = conn.Close()
			continue
		}
		atomic.AddInt64(&server.sessions, 1)
		server.wg.Add(1)
		go func() {
			defer server.wg.Done()
			defer atomic.AddInt64(&server.sessions, -1)
			server.handleConnection(conn)
		}()
	}
}

func (server *relayServer) Close() error {
	var closeErr error
	server.closeOnce.Do(func() {
		close(server.closed)
		closeErr = server.listener.Close()
	})
	server.wg.Wait()
	return closeErr
}

func (server *relayServer) handleConnection(client net.Conn) {
	defer client.Close()
	_ = client.SetDeadline(time.Now().Add(relayHandshakeTimeout))

	challengeBytes := make([]byte, 32)
	if _, err := rand.Read(challengeBytes); err != nil {
		return
	}
	challengeHex := hex.EncodeToString(challengeBytes)
	sessionID := "relay-" + challengeHex[:12]

	encoder := json.NewEncoder(client)
	hello := relayHello{V: gatewayRelayProtocol, Challenge: challengeHex, Session: sessionID}
	if err := encoder.Encode(hello); err != nil {
		fmt.Fprintf(os.Stderr, "[relay] session=%s handshake write failed: %v\n", sessionID, err)
		return
	}

	reader := bufio.NewReader(io.LimitReader(client, maxRelayRequestFrameBytes))
	line, err := reader.ReadBytes('\n')
	if err != nil {
		fmt.Fprintf(os.Stderr, "[relay] session=%s handshake read failed: %v\n", sessionID, err)
		return
	}
	var request relayRequest
	if err := json.Unmarshal(line, &request); err != nil || request.V != gatewayRelayProtocol {
		writeRelayError(encoder, "INVALID_REQUEST", "请求帧格式不合法")
		fmt.Fprintf(os.Stderr, "[relay] session=%s invalid request frame\n", sessionID)
		return
	}

	host := strings.TrimSpace(request.Host)
	if host == "" || strings.ContainsAny(host, "/\x00 \t\r\n") {
		writeRelayError(encoder, "INVALID_TARGET", "目标 host 不合法")
		return
	}
	if request.Port < 1 || request.Port > 65535 {
		writeRelayError(encoder, "INVALID_TARGET", "目标 port 不合法")
		return
	}

	signature, err := hex.DecodeString(strings.TrimSpace(request.Signature))
	if err != nil || len(signature) != ed25519.SignatureSize {
		writeRelayError(encoder, "AUTH_FAILED", "签名格式不合法")
		fmt.Fprintf(os.Stderr, "[relay] session=%s bad signature format\n", sessionID)
		return
	}
	signed := challengeHex + ":" + host + ":" + strconv.Itoa(request.Port)
	if !verifyRelaySignature(server.config, []byte(signed), signature) {
		writeRelayError(encoder, "AUTH_FAILED", "私有密钥认证失败")
		fmt.Fprintf(os.Stderr, "[relay] session=%s auth failed client=%s\n", sessionID, client.RemoteAddr())
		return
	}

	target := net.JoinHostPort(host, strconv.Itoa(request.Port))
	upstream, err := net.DialTimeout("tcp", target, relayDialTimeout)
	if err != nil {
		writeRelayError(encoder, "TARGET_UNREACHABLE", fmt.Sprintf("无法连接目标 %s: %v", target, err))
		fmt.Fprintf(os.Stderr, "[relay] session=%s target unreachable %s: %v\n", sessionID, target, err)
		return
	}
	defer upstream.Close()

	if err := encoder.Encode(relayResponse{OK: true}); err != nil {
		fmt.Fprintf(os.Stderr, "[relay] session=%s ok write failed: %v\n", sessionID, err)
		return
	}
	_ = client.SetDeadline(time.Time{})

	idleTimeout := effectiveRelayIdleTimeout(server.config)
	pumpRelayBytes(client, upstream, sessionID, target, idleTimeout)
	fmt.Fprintf(os.Stderr, "[relay] session=%s closed target=%s client=%s\n", sessionID, target, client.RemoteAddr())
}

func writeRelayError(encoder *json.Encoder, code, message string) {
	_ = encoder.Encode(relayResponse{OK: false, Error: code, Message: message})
}

func verifyRelaySignature(config *AgentConfig, signed []byte, signature []byte) bool {
	for _, publicKey := range relayClientPublicKeys(config) {
		if ed25519.Verify(publicKey, signed, signature) {
			return true
		}
	}
	return false
}

// pumpRelayBytes 双向透传原始字节；任一端 EOF/错误时只关闭对端写半连接，
// 保证 SSH 等依赖 half-close 的协议正常结束。idleTimeout 内无任何读写则强制断开。
func pumpRelayBytes(client net.Conn, upstream net.Conn, sessionID, target string, idleTimeout time.Duration) {
	left := newActivityConn(client, idleTimeout)
	right := newActivityConn(upstream, idleTimeout)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		copyAndHalfClose(right, left)
	}()
	go func() {
		defer wg.Done()
		copyAndHalfClose(left, right)
	}()
	wg.Wait()
	left.close()
	right.close()
}

type closeWriter interface {
	CloseWrite() error
}

func copyAndHalfClose(dst, src net.Conn) {
	_, _ = io.Copy(dst, src)
	if halfCloser, ok := dst.(closeWriter); ok {
		_ = halfCloser.CloseWrite()
	}
}

type activityConn struct {
	net.Conn
	idle   time.Duration
	last   atomic.Int64
	closed atomic.Bool
}

func newActivityConn(conn net.Conn, idle time.Duration) *activityConn {
	wrapped := &activityConn{Conn: conn, idle: idle}
	wrapped.last.Store(time.Now().UnixNano())
	go wrapped.watchdog()
	return wrapped
}

func (conn *activityConn) Read(buffer []byte) (int, error) {
	count, err := conn.Conn.Read(buffer)
	if count > 0 {
		conn.last.Store(time.Now().UnixNano())
	}
	return count, err
}

func (conn *activityConn) Write(buffer []byte) (int, error) {
	count, err := conn.Conn.Write(buffer)
	if count > 0 {
		conn.last.Store(time.Now().UnixNano())
	}
	return count, err
}

// CloseWrite 透传给底层 TCP 连接的 half-close，保证 SSH 等协议在单向 EOF 时能正常收尾。
func (conn *activityConn) CloseWrite() error {
	if halfCloser, ok := conn.Conn.(closeWriter); ok {
		return halfCloser.CloseWrite()
	}
	return nil
}

func (conn *activityConn) watchdog() {
	interval := relayIdleWatchdogGranularity
	if conn.idle > 0 && conn.idle < interval {
		interval = conn.idle / 2
		if interval < time.Second {
			interval = time.Second
		}
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		if conn.closed.Load() {
			return
		}
		if conn.idle > 0 && time.Since(time.Unix(0, conn.last.Load())) > conn.idle {
			_ = conn.Conn.Close()
			return
		}
	}
}

func (conn *activityConn) close() {
	if conn.closed.CompareAndSwap(false, true) {
		_ = conn.Conn.Close()
	}
}
