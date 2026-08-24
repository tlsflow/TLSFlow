package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/windows/svc"
)

const version = "0.1.0"

type config struct {
	ControlPlaneURL string `json:"controlPlaneUrl"`
	TenantID        string `json:"tenantId"`
	ProviderID      string `json:"providerId"`
	EnrollmentToken string `json:"enrollmentToken,omitempty"`
	NodeID          string `json:"nodeId,omitempty"`
	NodeName        string `json:"nodeName"`
	PollSeconds     int    `json:"pollSeconds"`
	DataDir         string `json:"dataDir"`
	CAConfig        string `json:"caConfig,omitempty"`
	DefaultTemplate string `json:"defaultTemplate,omitempty"`
}

type agent struct {
	configPath   string
	config       config
	client       *http.Client
	mu           sync.Mutex
	privateKey   ed25519.PrivateKey
	publicKeyPEM string
}

type serviceHandler struct{ agent *agent }

func main() {
	if len(os.Args) < 2 {
		fatal(errors.New("用法：gcac-adcs-agent <preflight|run|service run> --config <path>"))
	}
	command := os.Args[1]
	if command == "service" && len(os.Args) > 2 && os.Args[2] == "run" {
		runService(os.Args[3:])
		return
	}
	flags := flag.NewFlagSet(command, flag.ExitOnError)
	configPath := flags.String("config", "agent.config.json", "配置文件路径")
	_ = flags.Parse(os.Args[2:])
	instance, err := newAgent(*configPath)
	if err != nil {
		fatal(err)
	}
	switch command {
	case "preflight":
		result, err := instance.discover(context.Background())
		if err != nil {
			fatal(err)
		}
		writeStdout(result)
	case "run":
		fatal(instance.run(context.Background()))
	default:
		fatal(fmt.Errorf("不支持的命令：%s", command))
	}
}

func runService(args []string) {
	flags := flag.NewFlagSet("service run", flag.ExitOnError)
	configPath := flags.String("config", "agent.config.json", "配置文件路径")
	_ = flags.Parse(args)
	instance, err := newAgent(*configPath)
	if err != nil {
		fatal(err)
	}
	if err := svc.Run("gcac-adcs-agent", &serviceHandler{agent: instance}); err != nil {
		fatal(err)
	}
}

func (handler *serviceHandler) Execute(_ []string, requests <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	status <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- handler.agent.run(ctx) }()
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for {
		select {
		case request := <-requests:
			switch request.Cmd {
			case svc.Interrogate:
				status <- request.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				cancel()
				<-done
				return false, 0
			}
		case err := <-done:
			if err != nil {
				log.Printf("AD CS Agent 退出：%v", err)
				return true, 1
			}
			return false, 0
		}
	}
}

func newAgent(configPath string) (*agent, error) {
	content, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}
	var cfg config
	if err := json.Unmarshal(content, &cfg); err != nil {
		return nil, err
	}
	if cfg.ControlPlaneURL == "" || cfg.TenantID == "" || cfg.ProviderID == "" {
		return nil, errors.New("controlPlaneUrl、tenantId 和 providerId 必填")
	}
	if cfg.NodeName == "" {
		cfg.NodeName, _ = os.Hostname()
	}
	if cfg.PollSeconds < 5 {
		cfg.PollSeconds = 10
	}
	if cfg.DataDir == "" {
		cfg.DataDir = filepath.Dir(configPath)
	}
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		return nil, err
	}
	privateKey, publicKeyPEM, err := loadOrCreateIdentityKey(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	return &agent{configPath: configPath, config: cfg, client: &http.Client{Timeout: 45 * time.Second}, privateKey: privateKey, publicKeyPEM: publicKeyPEM}, nil
}

func (a *agent) run(ctx context.Context) error {
	discovery, err := a.discover(ctx)
	if err != nil {
		return err
	}
	if a.config.CAConfig == "" {
		a.config.CAConfig = fmt.Sprint(discovery["caConfig"])
	}
	if a.config.NodeID == "" {
		if err := a.register(discovery); err != nil {
			return err
		}
	}
	ticker := time.NewTicker(time.Duration(a.config.PollSeconds) * time.Second)
	defer ticker.Stop()
	for {
		if err := a.heartbeatAndLease(ctx); err != nil {
			log.Printf("控制面同步失败：%v", err)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

func (a *agent) discover(ctx context.Context) (map[string]any, error) {
	if _, err := exec.LookPath("certutil.exe"); err != nil {
		return nil, errors.New("未找到 certutil.exe")
	}
	active, err := runCommand(ctx, 20*time.Second, "reg.exe", "query", `HKLM\SYSTEM\CurrentControlSet\Services\CertSvc\Configuration`, "/v", "Active")
	if err != nil {
		return nil, errors.New("未发现本机 AD CS Certification Authority，请在 CA 服务器上安装 Agent")
	}
	caName := parseRegistryValue(active, "Active")
	if caName == "" {
		return nil, errors.New("无法读取活动 CA 名称")
	}
	hostname, _ := os.Hostname()
	caConfig := hostname + `\` + caName
	caInfo, err := runCommand(ctx, 30*time.Second, "certutil.exe", "-config", caConfig, "-cainfo")
	if err != nil {
		return nil, fmt.Errorf("无法访问 CA %s：%w", caConfig, err)
	}
	templatesOutput, templatesErr := runCommand(ctx, 30*time.Second, "certutil.exe", "-config", caConfig, "-CATemplates")
	if templatesErr != nil {
		return nil, fmt.Errorf("无法读取已发布模板：%w", templatesErr)
	}
	return map[string]any{
		"status": "ready", "caConfig": caConfig, "caName": caName, "computerName": hostname,
		"caInfo": caInfo, "templates": parseTemplateNames(templatesOutput), "templatesRaw": templatesOutput,
		"capabilities": capabilities(), "version": version,
	}, nil
}

func (a *agent) register(discovery map[string]any) error {
	if a.config.EnrollmentToken == "" {
		return errors.New("缺少一次性注册令牌")
	}
	publicKeyDER, err := x509.MarshalPKIXPublicKey(a.privateKey.Public())
	if err != nil {
		return err
	}
	identity := sha256.Sum256(publicKeyDER)
	payload := map[string]any{
		"token": a.config.EnrollmentToken, "name": a.config.NodeName, "platform": "windows", "role": "member",
		"identityFingerprint": hex.EncodeToString(identity[:]), "keyBackend": "file", "exportability": "exportable",
		"authenticationPublicKeyPem": a.publicKeyPEM, "capabilities": capabilities(), "version": version,
	}
	var response struct {
		ID string `json:"id"`
	}
	if err := a.post(ctxBackground(), "/api/v1/ca-nodes/register", payload, &response); err != nil {
		return err
	}
	if response.ID == "" {
		return errors.New("控制面未返回节点 ID")
	}
	a.config.NodeID = response.ID
	a.config.EnrollmentToken = ""
	return a.saveConfig()
}

func (a *agent) heartbeatAndLease(ctx context.Context) error {
	var heartbeat map[string]any
	if err := a.post(ctx, "/api/v1/ca-nodes/heartbeat", map[string]any{
		"nodeId": a.config.NodeID, "healthStatus": "online", "role": "member", "capabilities": capabilities(), "version": version,
	}, &heartbeat); err != nil {
		return err
	}
	var task map[string]any
	if err := a.post(ctx, "/api/v1/ca-nodes/tasks/lease", map[string]any{"nodeId": a.config.NodeID}, &task); err != nil {
		return err
	}
	if fmt.Sprint(task["id"]) == "" {
		return nil
	}
	return a.executeTask(ctx, task)
}

func (a *agent) executeTask(ctx context.Context, task map[string]any) error {
	taskID := fmt.Sprint(task["id"])
	taskType := fmt.Sprint(task["taskType"])
	payload, _ := task["payload"].(map[string]any)
	result, err := a.dispatch(ctx, taskType, payload)
	response := map[string]any{"nodeId": a.config.NodeID, "success": err == nil}
	if err == nil {
		response["result"] = result
	} else {
		response["errorCode"] = "ADCS_TASK_FAILED"
		response["errorMessage"] = err.Error()
	}
	return a.post(ctx, "/api/v1/ca-nodes/tasks/"+taskID+"/result", response, &map[string]any{})
}

func (a *agent) dispatch(ctx context.Context, taskType string, payload map[string]any) (map[string]any, error) {
	switch taskType {
	case "health_check", "discover_adcs":
		return a.discover(ctx)
	case "sign_csr":
		return a.submitCSR(ctx, payload)
	case "query_issuance":
		return a.retrieveRequest(ctx, payload)
	case "revoke_certificate":
		serial, err := payloadString(payload, "serialNumber")
		if err != nil {
			return nil, err
		}
		reason := certutilReason(fmt.Sprint(payload["reason"]))
		output, err := runCommand(ctx, 60*time.Second, "certutil.exe", "-config", a.caConfig(payload), "-revoke", serial, reason)
		return map[string]any{"serialNumber": serial, "revokedAt": time.Now().UTC().Format(time.RFC3339), "output": output}, err
	case "publish_crl":
		output, err := runCommand(ctx, 90*time.Second, "certutil.exe", "-config", a.caConfig(payload), "-crl")
		return map[string]any{"publishedAt": time.Now().UTC().Format(time.RFC3339), "output": output}, err
	default:
		return nil, fmt.Errorf("不支持的 AD CS 任务：%s", taskType)
	}
}

func (a *agent) submitCSR(ctx context.Context, payload map[string]any) (map[string]any, error) {
	csr, err := payloadString(payload, "csrPem")
	if err != nil {
		return nil, err
	}
	template, err := payloadString(payload, "template")
	if err != nil {
		return nil, err
	}
	directory, err := os.MkdirTemp(a.config.DataDir, "request-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(directory)
	csrPath := filepath.Join(directory, "request.req")
	certPath := filepath.Join(directory, "certificate.cer")
	if err := os.WriteFile(csrPath, []byte(csr), 0o600); err != nil {
		return nil, err
	}
	output, commandErr := runCommand(ctx, 90*time.Second, "certreq.exe", "-submit", "-config", a.caConfig(payload), "-attrib", "CertificateTemplate:"+template, csrPath, certPath)
	requestID := parseRequestID(output)
	if commandErr != nil && !strings.Contains(strings.ToLower(output), "pending") {
		return nil, fmt.Errorf("certreq 提交失败：%s", sanitizeOutput(output))
	}
	if _, err := os.Stat(certPath); err == nil {
		certificatePEM, readErr := certificateFileToPEM(ctx, certPath)
		if readErr != nil {
			return nil, readErr
		}
		return map[string]any{"status": "issued", "providerRequestId": requestID, "certificatePem": certificatePEM}, nil
	}
	return map[string]any{"status": "pending", "providerRequestId": requestID, "detail": sanitizeOutput(output)}, nil
}

func (a *agent) retrieveRequest(ctx context.Context, payload map[string]any) (map[string]any, error) {
	requestID, err := payloadString(payload, "providerRequestId")
	if err != nil {
		return nil, err
	}
	directory, err := os.MkdirTemp(a.config.DataDir, "retrieve-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(directory)
	certPath := filepath.Join(directory, "certificate.cer")
	output, commandErr := runCommand(ctx, 60*time.Second, "certreq.exe", "-retrieve", "-config", a.caConfig(payload), requestID, certPath)
	if commandErr != nil {
		lower := strings.ToLower(output)
		if strings.Contains(lower, "denied") {
			return map[string]any{"status": "rejected", "providerRequestId": requestID, "detail": sanitizeOutput(output)}, nil
		}
		return map[string]any{"status": "pending", "providerRequestId": requestID, "detail": sanitizeOutput(output)}, nil
	}
	certificatePEM, err := certificateFileToPEM(ctx, certPath)
	if err != nil {
		return nil, err
	}
	return map[string]any{"status": "issued", "providerRequestId": requestID, "certificatePem": certificatePEM, "detail": sanitizeOutput(output)}, nil
}

func (a *agent) caConfig(payload map[string]any) string {
	if value := strings.TrimSpace(fmt.Sprint(payload["caConfig"])); value != "" && value != "<nil>" {
		return value
	}
	return a.config.CAConfig
}

func (a *agent) post(ctx context.Context, path string, payload any, output any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.config.ControlPlaneURL, "/")+path, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set("x-tenant-id", a.config.TenantID)
	if a.config.NodeID != "" {
		timestamp := time.Now().UTC().Format(time.RFC3339Nano)
		nonceBytes := make([]byte, 24)
		if _, err := rand.Read(nonceBytes); err != nil {
			return err
		}
		nonce := base64.RawURLEncoding.EncodeToString(nonceBytes)
		bodyHash := sha256.Sum256(encoded)
		canonical := strings.Join([]string{http.MethodPost, path, a.config.TenantID, a.config.NodeID, timestamp, nonce, hex.EncodeToString(bodyHash[:])}, "\n")
		signature := ed25519.Sign(a.privateKey, []byte(canonical))
		request.Header.Set("x-gcac-node-id", a.config.NodeID)
		request.Header.Set("x-gcac-timestamp", timestamp)
		request.Header.Set("x-gcac-nonce", nonce)
		request.Header.Set("x-gcac-signature", base64.StdEncoding.EncodeToString(signature))
	}
	response, err := a.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 8*1024*1024))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("控制面返回 HTTP %d：%s", response.StatusCode, sanitizeOutput(string(body)))
	}
	if output != nil && len(body) > 0 {
		return json.Unmarshal(body, output)
	}
	return nil
}

func (a *agent) saveConfig() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	content, err := json.MarshalIndent(a.config, "", "  ")
	if err != nil {
		return err
	}
	temporary := a.configPath + ".tmp"
	if err := os.WriteFile(temporary, content, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, a.configPath)
}

func capabilities() map[string]bool {
	return map[string]bool{
		"discoverHierarchy": true, "createRoot": false, "createIntermediate": false, "signCsr": true,
		"queryIssuance": true, "revokeCertificate": true, "publishCrl": true, "ocsp": false,
		"listProfiles": true, "deviceLocalCsr": false, "hardwareBackedKey": true, "highAvailability": false,
	}
}

func runCommand(parent context.Context, timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	command := exec.CommandContext(ctx, name, args...)
	output, err := command.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return string(output), fmt.Errorf("命令执行超时：%s", name)
	}
	return string(output), err
}

func certificateFileToPEM(ctx context.Context, path string) (string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if bytes.Contains(content, []byte("BEGIN CERTIFICATE")) {
		return string(content), nil
	}
	outputPath := path + ".pem"
	if _, err := runCommand(ctx, 30*time.Second, "certutil.exe", "-encode", path, outputPath); err != nil {
		return "", err
	}
	encoded, err := os.ReadFile(outputPath)
	if err != nil {
		return "", err
	}
	block, _ := pem.Decode(encoded)
	if block == nil {
		return "", errors.New("无法解析签发证书")
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: block.Bytes})), nil
}

func parseRegistryValue(output, name string) string {
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) >= 3 && strings.EqualFold(fields[0], name) {
			return strings.Join(fields[2:], " ")
		}
	}
	return ""
}

func parseTemplateNames(output string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, line := range strings.Split(output, "\n") {
		value := strings.TrimSpace(strings.SplitN(line, "--", 2)[0])
		if value == "" || strings.Contains(value, ":") || strings.Contains(strings.ToLower(value), "certutil") || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func parseRequestID(output string) string {
	for _, line := range strings.Split(output, "\n") {
		lower := strings.ToLower(line)
		if !strings.Contains(lower, "requestid") && !strings.Contains(lower, "request id") {
			continue
		}
		for _, field := range strings.FieldsFunc(line, func(r rune) bool { return r < '0' || r > '9' }) {
			if _, err := strconv.ParseUint(field, 10, 64); err == nil {
				return field
			}
		}
	}
	return ""
}

func payloadString(payload map[string]any, key string) (string, error) {
	value := strings.TrimSpace(fmt.Sprint(payload[key]))
	if value == "" || value == "<nil>" {
		return "", fmt.Errorf("任务缺少字段：%s", key)
	}
	return value, nil
}

func certutilReason(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "keycompromise":
		return "1"
	case "cacompromise":
		return "2"
	case "affiliationchanged":
		return "3"
	case "superseded":
		return "4"
	case "cessationofoperation":
		return "5"
	case "certificatehold":
		return "6"
	default:
		return "0"
	}
}

func sanitizeOutput(value string) string {
	value = strings.ReplaceAll(value, "\x00", "")
	value = strings.TrimSpace(value)
	if len(value) > 4096 {
		return value[:4096]
	}
	return value
}

func ctxBackground() context.Context { return context.Background() }

func writeStdout(value any) {
	encoded, _ := json.MarshalIndent(value, "", "  ")
	fmt.Println(string(encoded))
}

func loadOrCreateIdentityKey(dataDir string) (ed25519.PrivateKey, string, error) {
	path := filepath.Join(dataDir, "node-identity.pem")
	if content, err := os.ReadFile(path); err == nil {
		block, _ := pem.Decode(content)
		if block == nil {
			return nil, "", errors.New("节点身份私钥格式无效")
		}
		parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, "", err
		}
		privateKey, ok := parsed.(ed25519.PrivateKey)
		if !ok {
			return nil, "", errors.New("节点身份私钥类型无效")
		}
		return identityKeyResult(privateKey)
	}
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, "", err
	}
	der, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return nil, "", err
	}
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0o600); err != nil {
		return nil, "", err
	}
	return identityKeyResult(privateKey)
}

func identityKeyResult(privateKey ed25519.PrivateKey) (ed25519.PrivateKey, string, error) {
	der, err := x509.MarshalPKIXPublicKey(privateKey.Public())
	if err != nil {
		return nil, "", err
	}
	return privateKey, string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})), nil
}

func fatal(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
