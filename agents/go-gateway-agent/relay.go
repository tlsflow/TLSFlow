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
// 认证通过后仍必须通过本地目标白名单、端口白名单和 DNS/IP 出站策略。
// 签名只证明客户端身份和本次目标绑定，不代表目标本身已获准访问。

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
	accepted  int64
	rejected  int64
	mu        sync.Mutex
	conns     map[net.Conn]struct{}
}

// lookupRelayIPs 单独抽出解析器，便于安全测试模拟 DNS rebinding。
var lookupRelayIPs = net.LookupIP

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

func relayTargetPolicyConfigured(config *AgentConfig) bool {
	if len(config.RelayAllowedTargets) == 0 || len(config.RelayAllowedPorts) == 0 {
		return false
	}
	for _, port := range config.RelayAllowedPorts {
		if port < 1 || port > 65535 {
			return false
		}
	}
	for _, raw := range config.RelayAllowedTargets {
		entry := canonicalRelayHost(raw)
		if entry == "" || !validRelayTargetEntry(entry) {
			return false
		}
	}
	return true
}

func validRelayTargetEntry(value string) bool {
	if net.ParseIP(value) != nil {
		return true
	}
	if _, _, err := net.ParseCIDR(value); err == nil {
		return true
	}
	if len(value) > 253 || strings.HasPrefix(value, ".") || strings.HasSuffix(value, ".") {
		return false
	}
	for _, label := range strings.Split(value, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, character := range label {
			if (character < 'a' || character > 'z') && (character < '0' || character > '9') && character != '-' {
				return false
			}
		}
	}
	return true
}

func relayPortAllowed(config *AgentConfig, port int) bool {
	for _, allowed := range config.RelayAllowedPorts {
		if allowed == port {
			return true
		}
	}
	return false
}

func canonicalRelayHost(value string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(value)), ".")
}

func relayHostAllowlisted(config *AgentConfig, host string) bool {
	canonical := canonicalRelayHost(host)
	for _, raw := range config.RelayAllowedTargets {
		entry := canonicalRelayHost(raw)
		if entry == canonical {
			return true
		}
	}
	return false
}

func relayAddressAllowlisted(config *AgentConfig, ip net.IP) bool {
	for _, raw := range config.RelayAllowedTargets {
		entry := strings.TrimSpace(raw)
		if parsed := net.ParseIP(entry); parsed != nil && parsed.Equal(ip) {
			return true
		}
		if _, network, err := net.ParseCIDR(entry); err == nil && network.Contains(ip) {
			return true
		}
	}
	return false
}

func restrictedRelayIP(ip net.IP) bool {
	if ip == nil || ip.IsUnspecified() || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return true
	}
	for _, raw := range []string{
		"0.0.0.0/8", "100.64.0.0/10", "169.254.0.0/16", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4",
		"::/128", "::1/128", "fc00::/7", "fe80::/10", "ff00::/8", "2001:db8::/32",
	} {
		if _, network, err := net.ParseCIDR(raw); err == nil && network.Contains(ip) {
			return true
		}
	}
	// 常见云平台元数据地址，即使部署网络错误配置也不允许访问。
	for _, raw := range []string{"169.254.169.254", "169.254.170.2", "100.100.100.200"} {
		if net.ParseIP(raw).Equal(ip) {
			return true
		}
	}
	return false
}

func resolveRelayTarget(config *AgentConfig, host string, port int) ([]net.IP, string, error) {
	if !relayPortAllowed(config, port) {
		return nil, "PORT_NOT_ALLOWED", errors.New("目标 port 未被 Relay 端口白名单允许")
	}
	canonical := canonicalRelayHost(host)
	if canonical == "" || strings.ContainsAny(canonical, "/\\\x00 \t\r\n%") {
		return nil, "INVALID_TARGET", errors.New("目标 host 不合法")
	}
	hostIsIP := net.ParseIP(canonical) != nil
	if !hostIsIP && !relayHostAllowlisted(config, canonical) {
		return nil, "TARGET_NOT_ALLOWED", errors.New("目标 host 不在 Relay 白名单")
	}
	ips, err := lookupRelayIPs(canonical)
	if err != nil || len(ips) == 0 {
		if hostIsIP {
			ips = []net.IP{net.ParseIP(canonical)}
		} else {
			return nil, "TARGET_RESOLUTION_FAILED", fmt.Errorf("目标 host 解析失败: %w", err)
		}
	}
	resolved := make([]net.IP, 0, len(ips))
	for _, ip := range ips {
		if ip == nil {
			return nil, "TARGET_RESOLUTION_FAILED", errors.New("目标 DNS 返回空地址")
		}
		ip = append(net.IP(nil), ip...)
		addressListed := relayAddressAllowlisted(config, ip)
		if restrictedRelayIP(ip) && !addressListed {
			return nil, "TARGET_SSRF_BLOCKED", fmt.Errorf("目标解析到受限制地址 %s", ip.String())
		}
		if hostIsIP && !addressListed {
			return nil, "TARGET_NOT_ALLOWED", fmt.Errorf("目标 IP %s 不在 Relay 白名单", ip.String())
		}
		resolved = append(resolved, ip)
	}
	return resolved, "", nil
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
	if !effectiveRelayEnabled(config) {
		return nil, nil
	}
	if len(relayClientPublicKeys(config)) == 0 {
		return nil, errors.New("TCP 中继已启用但未配置 relayClientPublicKeys")
	}
	if !relayTargetPolicyConfigured(config) {
		return nil, errors.New("TCP 中继已启用但未配置 relayAllowedTargets/relayAllowedPorts")
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
		conns:    make(map[net.Conn]struct{}),
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
		if !server.tryAcquireSession() {
			_ = conn.Close()
			atomic.AddInt64(&server.rejected, 1)
			server.audit("rejected", "CONCURRENCY_LIMIT", "", "", 0, 0)
			continue
		}
		server.trackConnection(conn)
		atomic.AddInt64(&server.accepted, 1)
		server.wg.Add(1)
		go func() {
			defer server.wg.Done()
			defer server.releaseSession(conn)
			server.handleConnection(conn)
		}()
	}
}

func (server *relayServer) tryAcquireSession() bool {
	for {
		current := atomic.LoadInt64(&server.sessions)
		if current >= maxRelayConcurrentSessions {
			return false
		}
		if atomic.CompareAndSwapInt64(&server.sessions, current, current+1) {
			return true
		}
	}
}

func (server *relayServer) trackConnection(conn net.Conn) {
	server.mu.Lock()
	server.conns[conn] = struct{}{}
	server.mu.Unlock()
}

func (server *relayServer) releaseSession(conn net.Conn) {
	server.mu.Lock()
	delete(server.conns, conn)
	server.mu.Unlock()
	atomic.AddInt64(&server.sessions, -1)
}

func (server *relayServer) audit(phase, outcome, sessionID, target string, clientBytes, targetBytes int64) {
	_ = json.NewEncoder(os.Stderr).Encode(map[string]any{
		"component":        "gateway-relay",
		"phase":            phase,
		"outcome":          outcome,
		"session":          sessionID,
		"target":           target,
		"clientBytes":      clientBytes,
		"targetBytes":      targetBytes,
		"activeSessions":   atomic.LoadInt64(&server.sessions),
		"acceptedSessions": atomic.LoadInt64(&server.accepted),
		"rejectedSessions": atomic.LoadInt64(&server.rejected),
		"at":               time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func (server *relayServer) Close() error {
	var closeErr error
	server.closeOnce.Do(func() {
		close(server.closed)
		closeErr = server.listener.Close()
		server.mu.Lock()
		connections := make([]net.Conn, 0, len(server.conns))
		for conn := range server.conns {
			connections = append(connections, conn)
		}
		server.mu.Unlock()
		for _, conn := range connections {
			_ = conn.Close()
		}
	})
	server.wg.Wait()
	return closeErr
}

func (server *relayServer) handleConnection(client net.Conn) {
	defer client.Close()
	sessionID := ""
	targetName := ""
	outcome := "HANDSHAKE_FAILED"
	var clientBytes, targetBytes int64
	defer func() { server.audit("session", outcome, sessionID, targetName, clientBytes, targetBytes) }()
	_ = client.SetDeadline(time.Now().Add(relayHandshakeTimeout))

	challengeBytes := make([]byte, 32)
	if _, err := rand.Read(challengeBytes); err != nil {
		outcome = "CHALLENGE_GENERATION_FAILED"
		return
	}
	challengeHex := hex.EncodeToString(challengeBytes)
	sessionID = "relay-" + challengeHex[:12]

	encoder := json.NewEncoder(client)
	hello := relayHello{V: gatewayRelayProtocol, Challenge: challengeHex, Session: sessionID}
	if err := encoder.Encode(hello); err != nil {
		outcome = "HANDSHAKE_WRITE_FAILED"
		fmt.Fprintf(os.Stderr, "[relay] session=%s handshake write failed: %v\n", sessionID, err)
		return
	}

	reader := bufio.NewReaderSize(client, maxRelayRequestFrameBytes+1)
	line, err := readRelayFrame(reader, maxRelayRequestFrameBytes)
	if err != nil {
		if errors.Is(err, errRelayFrameTooLarge) {
			outcome = "FRAME_TOO_LARGE"
		} else if timeoutErr, ok := err.(net.Error); ok && timeoutErr.Timeout() {
			outcome = "HANDSHAKE_TIMEOUT"
		} else {
			outcome = "HANDSHAKE_READ_FAILED"
		}
		fmt.Fprintf(os.Stderr, "[relay] session=%s handshake read failed: %v\n", sessionID, err)
		return
	}
	var request relayRequest
	if err := json.Unmarshal(line, &request); err != nil || request.V != gatewayRelayProtocol {
		outcome = "INVALID_REQUEST"
		writeRelayError(encoder, "INVALID_REQUEST", "请求帧格式不合法")
		fmt.Fprintf(os.Stderr, "[relay] session=%s invalid request frame\n", sessionID)
		return
	}

	host := canonicalRelayHost(request.Host)
	targetName = net.JoinHostPort(host, strconv.Itoa(request.Port))
	if host == "" || strings.ContainsAny(host, "/\\\x00 \t\r\n%") {
		outcome = "INVALID_TARGET"
		writeRelayError(encoder, "INVALID_TARGET", "目标 host 不合法")
		return
	}
	if request.Port < 1 || request.Port > 65535 {
		outcome = "INVALID_TARGET"
		writeRelayError(encoder, "INVALID_TARGET", "目标 port 不合法")
		return
	}

	signature, err := hex.DecodeString(strings.TrimSpace(request.Signature))
	if err != nil || len(signature) != ed25519.SignatureSize {
		outcome = "AUTH_FAILED"
		writeRelayError(encoder, "AUTH_FAILED", "签名格式不合法")
		fmt.Fprintf(os.Stderr, "[relay] session=%s bad signature format\n", sessionID)
		return
	}
	signed := challengeHex + ":" + host + ":" + strconv.Itoa(request.Port)
	if !verifyRelaySignature(server.config, []byte(signed), signature) {
		outcome = "AUTH_FAILED"
		writeRelayError(encoder, "AUTH_FAILED", "私有密钥认证失败")
		fmt.Fprintf(os.Stderr, "[relay] session=%s auth failed client=%s\n", sessionID, client.RemoteAddr())
		return
	}

	resolvedIPs, policyCode, err := resolveRelayTarget(server.config, host, request.Port)
	if err != nil {
		outcome = policyCode
		writeRelayError(encoder, policyCode, err.Error())
		fmt.Fprintf(os.Stderr, "[relay] session=%s target policy denied %s: %v\n", sessionID, targetName, err)
		return
	}

	var upstream net.Conn
	var dialErr error
	for _, ip := range resolvedIPs {
		upstream, dialErr = net.DialTimeout("tcp", net.JoinHostPort(ip.String(), strconv.Itoa(request.Port)), relayDialTimeout)
		if dialErr == nil {
			break
		}
	}
	if dialErr != nil {
		outcome = "TARGET_UNREACHABLE"
		writeRelayError(encoder, "TARGET_UNREACHABLE", fmt.Sprintf("无法连接目标 %s: %v", targetName, dialErr))
		fmt.Fprintf(os.Stderr, "[relay] session=%s target unreachable %s: %v\n", sessionID, targetName, dialErr)
		return
	}
	defer upstream.Close()

	if err := encoder.Encode(relayResponse{OK: true}); err != nil {
		outcome = "HANDSHAKE_WRITE_FAILED"
		fmt.Fprintf(os.Stderr, "[relay] session=%s ok write failed: %v\n", sessionID, err)
		return
	}
	_ = client.SetDeadline(time.Time{})

	idleTimeout := effectiveRelayIdleTimeout(server.config)
	result := pumpRelayBytes(&bufferedConn{Conn: client, reader: reader}, upstream, idleTimeout)
	clientBytes = result.clientToTarget
	targetBytes = result.targetToClient
	outcome = result.outcome
	fmt.Fprintf(os.Stderr, "[relay] session=%s closed target=%s client=%s outcome=%s\n", sessionID, targetName, client.RemoteAddr(), outcome)
}

var errRelayFrameTooLarge = errors.New("Relay 握手帧超出长度限制")

func readRelayFrame(reader *bufio.Reader, maxBytes int) ([]byte, error) {
	frame := make([]byte, 0, maxBytes)
	for {
		chunk, err := reader.ReadSlice('\n')
		frame = append(frame, chunk...)
		if len(frame) > maxBytes {
			return nil, errRelayFrameTooLarge
		}
		if err == nil {
			return frame, nil
		}
		if !errors.Is(err, bufio.ErrBufferFull) {
			return nil, err
		}
	}
}

// bufferedConn 把握手阶段已经预读的字节交还给 TCP 泵，避免同一写包中的业务字节丢失。
type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (conn *bufferedConn) Read(buffer []byte) (int, error) { return conn.reader.Read(buffer) }

func (conn *bufferedConn) CloseWrite() error {
	if halfCloser, ok := conn.Conn.(closeWriter); ok {
		return halfCloser.CloseWrite()
	}
	return nil
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
type relayPumpResult struct {
	clientToTarget int64
	targetToClient int64
	outcome        string
}

func pumpRelayBytes(client net.Conn, upstream net.Conn, idleTimeout time.Duration) relayPumpResult {
	left := newActivityConn(client, idleTimeout)
	right := newActivityConn(upstream, idleTimeout)

	type copyResult struct {
		clientToTarget int64
		targetToClient int64
	}
	results := make(chan copyResult, 2)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		results <- copyResult{clientToTarget: copyAndHalfClose(right, left)}
	}()
	go func() {
		defer wg.Done()
		results <- copyResult{targetToClient: copyAndHalfClose(left, right)}
	}()
	wg.Wait()
	left.close()
	right.close()
	first := <-results
	second := <-results
	clientToTarget := first.clientToTarget + second.clientToTarget
	targetToClient := first.targetToClient + second.targetToClient
	outcome := "PEER_CLOSED"
	if left.timedOut.Load() || right.timedOut.Load() {
		outcome = "IDLE_TIMEOUT"
	}
	return relayPumpResult{clientToTarget: clientToTarget, targetToClient: targetToClient, outcome: outcome}
}

type closeWriter interface {
	CloseWrite() error
}

func copyAndHalfClose(dst, src net.Conn) int64 {
	count, _ := io.Copy(dst, src)
	if halfCloser, ok := dst.(closeWriter); ok {
		_ = halfCloser.CloseWrite()
	}
	return count
}

type activityConn struct {
	net.Conn
	idle     time.Duration
	last     atomic.Int64
	closed   atomic.Bool
	timedOut atomic.Bool
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
			conn.timedOut.Store(true)
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
