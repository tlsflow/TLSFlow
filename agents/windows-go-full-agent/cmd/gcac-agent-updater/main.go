package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	maxArtifactSize int64 = 512 * 1024 * 1024
	// Windows bootstrap 内嵌 Agent、updater 和发现插件的 base64 制品，大小明显高于单个脚本。
	maxBootstrapSize int64 = 128 * 1024 * 1024
)

type upgradeStatus struct {
	SchemaVersion  string `json:"schemaVersion"`
	PlanID         string `json:"planId"`
	TransactionID  string `json:"transactionId"`
	AgentID        string `json:"agentId"`
	FromVersion    string `json:"fromVersion"`
	TargetVersion  string `json:"targetVersion"`
	ArtifactSHA256 string `json:"artifactSha256"`
	Phase          string `json:"phase"`
	Status         string `json:"status"`
	ErrorCode      string `json:"errorCode,omitempty"`
	ErrorMessage   string `json:"errorMessage,omitempty"`
	Rollback       string `json:"rollback,omitempty"`
	UpdatedAt      string `json:"updatedAt"`
	ObservedAt     string `json:"observedAt"`
}

func main() {
	if err := ensureWindowsRuntime(); err != nil {
		fail(err)
	}
	flags := flag.NewFlagSet("gcac-agent-updater", flag.ContinueOnError)
	artifact := flags.String("artifact", "", "待安装升级制品")
	target := flags.String("target", "", "当前 Agent 可执行文件")
	backup := flags.String("backup", "", "回滚备份路径")
	service := flags.String("service", "", "Windows 服务名")
	statusPath := flags.String("status", "", "升级状态路径")
	transactionID := flags.String("transaction-id", "", "升级事务 ID")
	planID := flags.String("plan-id", "", "升级计划 ID")
	agentID := flags.String("agent-id", "", "Agent ID")
	fromVersion := flags.String("from-version", "", "当前版本")
	toVersion := flags.String("to-version", "", "目标版本")
	expectedSHA256 := flags.String("expected-sha256", "", "制品 SHA-256")
	artifactSignature := flags.String("artifact-signature", "", "制品签名")
	releasePublicKey := flags.String("release-public-key", "", "制品签名公钥")
	releaseKeyID := flags.String("release-key-id", "", "制品签名 Key ID")
	bootstrapURL := flags.String("bootstrap-url", "", "正式 Windows 安装 bootstrap 地址")
	healthPort := flags.Int("health-port", 18930, "管理健康端口")
	healthTimeoutSeconds := flags.Int("health-timeout-seconds", 90, "健康检查超时")
	healthTLS := flags.Bool("health-tls", false, "使用 mTLS 执行本机健康检查")
	healthCA := flags.String("health-ca", "", "健康检查服务器 CA")
	healthCert := flags.String("health-cert", "", "健康检查客户端证书")
	healthKey := flags.String("health-key", "", "健康检查客户端私钥")
	if err := flags.Parse(os.Args[1:]); err != nil {
		fail(err)
	}
	args := updaterArgs{
		artifact: *artifact, target: *target, backup: *backup, service: *service, statusPath: *statusPath,
		transactionID: *transactionID, planID: *planID, agentID: *agentID, fromVersion: *fromVersion, toVersion: *toVersion,
		expectedSHA256: *expectedSHA256, artifactSignature: *artifactSignature,
		releasePublicKey: *releasePublicKey, releaseKeyID: *releaseKeyID,
		bootstrapURL: *bootstrapURL,
		healthPort:   *healthPort, healthTimeout: time.Duration(*healthTimeoutSeconds) * time.Second,
		healthTLS: *healthTLS, healthCA: *healthCA, healthCert: *healthCert, healthKey: *healthKey,
	}
	if err := runUpgrade(args); err != nil {
		writeFailure(args, err)
		fail(err)
	}
}

type updaterArgs struct {
	artifact, target, backup, service, statusPath, transactionID string
	planID, agentID                                              string
	fromVersion, toVersion, expectedSHA256, artifactSignature    string
	releasePublicKey, releaseKeyID                               string
	bootstrapURL                                                 string
	healthPort                                                   int
	healthTimeout                                                time.Duration
	healthTLS                                                    bool
	healthCA, healthCert, healthKey                              string
}

func runUpgrade(args updaterArgs) error {
	if err := validateArgs(args); err != nil {
		return err
	}
	if args.bootstrapURL != "" {
		return runBootstrap(args)
	}
	if err := verifyArtifact(args); err != nil {
		return err
	}
	status := upgradeStatus{
		SchemaVersion: "management.upgrade.v1", PlanID: args.planID, TransactionID: args.transactionID, AgentID: args.agentID,
		FromVersion: args.fromVersion, TargetVersion: args.toVersion,
		ArtifactSHA256: strings.ToLower(args.expectedSHA256), Phase: "quiescing", Status: "running",
		ObservedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := saveStatus(args.statusPath, status); err != nil {
		return err
	}
	if err := stopService(args.service); err != nil {
		return rollback(args, status, "SERVICE_STOP_FAILED", err)
	}
	status.Phase = "swapping"
	if err := saveStatus(args.statusPath, status); err != nil {
		return rollback(args, status, "UPGRADE_STATE_WRITE_FAILED", err)
	}
	if err := os.Remove(args.backup); err != nil && !os.IsNotExist(err) {
		return rollback(args, status, "BACKUP_CLEANUP_FAILED", err)
	}
	if err := os.Rename(args.target, args.backup); err != nil {
		return rollback(args, status, "TARGET_BACKUP_FAILED", err)
	}
	if err := os.Rename(args.artifact, args.target); err != nil {
		return rollback(args, status, "TARGET_REPLACE_FAILED", err)
	}
	status.Phase = "starting"
	if err := saveStatus(args.statusPath, status); err != nil {
		return rollback(args, status, "UPGRADE_STATE_WRITE_FAILED", err)
	}
	if err := startService(args.service); err != nil {
		return rollback(args, status, "SERVICE_START_FAILED", err)
	}
	status.Phase = "health_checking"
	if err := saveStatus(args.statusPath, status); err != nil {
		return rollback(args, status, "UPGRADE_STATE_WRITE_FAILED", err)
	}
	if err := waitForHealth(args.healthPort, args.toVersion, args.healthTimeout, args.healthTLS, args.healthCA, args.healthCert, args.healthKey); err != nil {
		return rollback(args, status, "POST_UPGRADE_HEALTH_FAILED", err)
	}
	status.Phase = "succeeded"
	status.Status = "succeeded"
	status.Rollback = "not_required"
	if err := saveStatus(args.statusPath, status); err != nil {
		return err
	}
	_ = os.Remove(args.artifact)
	return nil
}

func validateArgs(args updaterArgs) error {
	if args.bootstrapURL != "" {
		if args.statusPath == "" || args.transactionID == "" || args.planID == "" || args.agentID == "" || args.toVersion == "" {
			return errors.New("bootstrap 升级器参数不完整")
		}
		if !filepath.IsAbs(args.statusPath) {
			return errors.New("bootstrap 状态路径必须是绝对路径")
		}
		parsed, err := url.Parse(strings.TrimSpace(args.bootstrapURL))
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
			return errors.New("bootstrap 地址必须是 HTTP(S) 地址")
		}
		return nil
	}
	if args.artifact == "" || args.target == "" || args.backup == "" || args.service == "" || args.statusPath == "" || args.transactionID == "" || args.planID == "" || args.agentID == "" || args.toVersion == "" || args.healthPort <= 0 || args.healthPort > 65535 {
		return errors.New("升级器参数不完整")
	}
	if args.healthTLS && (args.healthCA == "" || args.healthCert == "" || args.healthKey == "") {
		return errors.New("mTLS 健康检查参数不完整")
	}
	if !filepath.IsAbs(args.artifact) || !filepath.IsAbs(args.target) || !filepath.IsAbs(args.backup) || !filepath.IsAbs(args.statusPath) {
		return errors.New("升级器路径必须是绝对路径")
	}
	if filepath.Clean(args.target) == filepath.Clean(args.artifact) || filepath.Clean(args.target) == filepath.Clean(args.backup) {
		return errors.New("升级器目标路径冲突")
	}
	if len(args.service) > 256 || strings.ContainsAny(args.service, "\\/\"'") {
		return errors.New("Windows 服务名无效")
	}
	return nil
}

func runBootstrap(args updaterArgs) error {
	status := upgradeStatus{
		SchemaVersion: "management.upgrade.v1", PlanID: args.planID, TransactionID: args.transactionID, AgentID: args.agentID,
		FromVersion: args.fromVersion, TargetVersion: args.toVersion, ArtifactSHA256: strings.ToLower(args.expectedSHA256), Phase: "downloading_script", Status: "running",
		ObservedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := saveStatus(args.statusPath, status); err != nil {
		return err
	}
	script, err := downloadBootstrap(args.bootstrapURL)
	if err != nil {
		return err
	}
	status.Phase = "executing_script"
	if err := saveStatus(args.statusPath, status); err != nil {
		return err
	}
	scriptPath := args.statusPath + fmt.Sprintf(".bootstrap-%d.ps1", os.Getpid())
	if err := writeBootstrapScript(scriptPath, script); err != nil {
		return fmt.Errorf("写入 bootstrap 临时脚本失败: %w", err)
	}
	defer os.Remove(scriptPath)
	command := exec.Command(windowsPowerShellPath, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath)
	command.Dir = windowsSystem32Directory
	output, err := command.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if len(message) > 1000 {
			message = message[len(message)-1000:]
		}
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("Windows bootstrap 执行失败: %s", message)
	}
	status.Phase = "succeeded"
	status.Status = "succeeded"
	status.Rollback = "not_required"
	return saveStatus(args.statusPath, status)
}

// writeBootstrapScript 使用 UTF-8 BOM 写入脚本，兼容 Windows PowerShell 5.1 的默认编码识别。
func writeBootstrapScript(path, script string) error {
	content := []byte(strings.TrimPrefix(script, "\uFEFF"))
	content = append([]byte{0xEF, 0xBB, 0xBF}, content...)
	return os.WriteFile(path, content, 0o600)
}

func downloadBootstrap(rawURL string) (string, error) {
	request, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return "", fmt.Errorf("创建 bootstrap 下载请求失败: %w", err)
	}
	client := &http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return errors.New("bootstrap 下载禁止重定向") }}
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("下载 bootstrap 失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载 bootstrap 返回 HTTP %d", response.StatusCode)
	}
	if response.ContentLength > maxBootstrapSize {
		return "", errors.New("bootstrap 文件过大")
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, maxBootstrapSize+1))
	if err != nil {
		return "", fmt.Errorf("读取 bootstrap 失败: %w", err)
	}
	if len(content) == 0 || int64(len(content)) > maxBootstrapSize {
		return "", errors.New("bootstrap 内容为空或过大")
	}
	return string(content), nil
}

func verifyArtifact(args updaterArgs) error {
	info, err := os.Stat(args.artifact)
	if err != nil {
		return fmt.Errorf("读取升级制品失败: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > maxArtifactSize {
		return errors.New("升级制品大小或文件类型无效")
	}
	artifact, err := os.ReadFile(args.artifact)
	if err != nil {
		return fmt.Errorf("读取升级制品失败: %w", err)
	}
	digestBytes := sha256.Sum256(artifact)
	digest := hex.EncodeToString(digestBytes[:])
	if !strings.EqualFold(digest, args.expectedSHA256) {
		return errors.New("升级器 SHA-256 校验失败")
	}
	// 测试/开发环境可以只依赖 Release SHA-256；配置发布公钥时仍强制验签。
	if strings.TrimSpace(args.releasePublicKey) == "" && strings.TrimSpace(args.artifactSignature) == "" {
		return nil
	}
	publicKey, err := decodePublicKey(args.releasePublicKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize || args.releaseKeyID == "" {
		return errors.New("升级器发布公钥无效")
	}
	signature, err := decodeSignature(args.artifactSignature)
	if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(ed25519.PublicKey(publicKey), artifact, signature) {
		return errors.New("升级器发布签名校验失败")
	}
	return nil
}

func decodePublicKey(value string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil {
		decoded, err = base64.StdEncoding.DecodeString(strings.TrimSpace(value))
	}
	return decoded, err
}

func decodeSignature(value string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil {
		decoded, err = base64.StdEncoding.DecodeString(strings.TrimSpace(value))
	}
	return decoded, err
}

func stopService(service string) error {
	state, err := serviceState(service)
	if err != nil {
		return err
	}
	if state == 1 {
		return nil
	}
	if _, err := runSC("stop", service); err != nil {
		return err
	}
	return waitForServiceState(service, 1, 60*time.Second)
}

func startService(service string) error {
	if _, err := runSC("start", service); err != nil {
		return err
	}
	return waitForServiceState(service, 4, 60*time.Second)
}

func serviceState(service string) (int, error) {
	output, err := runSC("query", service)
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(output, "\n") {
		upper := strings.ToUpper(line)
		index := strings.Index(upper, "STATE")
		if index < 0 {
			continue
		}
		fields := strings.Fields(line[index:])
		for _, field := range fields {
			if value, parseErr := strconv.Atoi(strings.Trim(field, ":")); parseErr == nil && value >= 1 && value <= 7 {
				return value, nil
			}
		}
	}
	return 0, errors.New("无法解析 Windows Service 状态")
}

func waitForServiceState(service string, expected int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		state, err := serviceState(service)
		if err == nil && state == expected {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("Windows Service 未进入预期状态 %d: %s", expected, service)
}

func runSC(args ...string) (string, error) {
	command := exec.Command("sc.exe", args...)
	output, err := command.CombinedOutput()
	if err != nil {
		return string(output), fmt.Errorf("sc.exe %s 失败: %w", strings.Join(args, " "), err)
	}
	return string(output), nil
}

func waitForHealth(port int, expectedVersion string, timeout time.Duration, useTLS bool, caPath, certPath, keyPath string) error {
	transport := &http.Transport{}
	scheme := "http"
	if useTLS {
		caBytes, err := os.ReadFile(caPath)
		if err != nil {
			return fmt.Errorf("读取健康检查服务器 CA 失败: %w", err)
		}
		roots := x509.NewCertPool()
		if !roots.AppendCertsFromPEM(caBytes) {
			return errors.New("健康检查服务器 CA PEM 无效")
		}
		certificate, err := tls.LoadX509KeyPair(certPath, keyPath)
		if err != nil {
			return fmt.Errorf("加载健康检查客户端证书失败: %w", err)
		}
		transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots, Certificates: []tls.Certificate{certificate}}
		scheme = "https"
	}
	client := &http.Client{Timeout: 5 * time.Second, Transport: transport}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		request, err := http.NewRequest(http.MethodGet, fmt.Sprintf("%s://127.0.0.1:%d/api/v1/control/health", scheme, port), nil)
		if err == nil {
			response, requestErr := client.Do(request)
			if requestErr == nil {
				body, readErr := io.ReadAll(response.Body)
				_ = response.Body.Close()
				if readErr == nil && response.StatusCode == http.StatusOK {
					var value map[string]any
					if json.Unmarshal(body, &value) == nil && value["agentVersion"] == expectedVersion {
						return nil
					}
				}
			}
		}
		time.Sleep(time.Second)
	}
	return fmt.Errorf("Agent 健康检查未确认目标版本 %s", expectedVersion)
}

func rollback(args updaterArgs, status upgradeStatus, code string, cause error) error {
	status.Status = "rolled_back"
	status.Phase = "rollbacking"
	status.ErrorCode = code
	status.ErrorMessage = cause.Error()
	status.Rollback = "attempting"
	_ = saveStatus(args.statusPath, status)
	_ = stopService(args.service)
	restoreErr := error(nil)
	if _, backupErr := os.Stat(args.backup); backupErr == nil {
		if removeErr := os.Remove(args.target); removeErr != nil && !os.IsNotExist(removeErr) {
			restoreErr = removeErr
		} else {
			restoreErr = os.Rename(args.backup, args.target)
		}
	} else if _, targetErr := os.Stat(args.target); targetErr != nil {
		restoreErr = fmt.Errorf("回滚时新旧 Agent 文件均不存在: %w", targetErr)
	}
	if restoreErr == nil {
		restoreErr = startService(args.service)
	}
	if restoreErr != nil {
		status.Status = "manual_required"
		status.Phase = "manual_required"
		status.Rollback = "failed"
		status.ErrorCode = "AGENT_UPGRADE_ROLLBACK_FAILED"
		status.ErrorMessage = restoreErr.Error()
	} else {
		status.Phase = "rolled_back"
		status.Rollback = "succeeded"
	}
	_ = saveStatus(args.statusPath, status)
	return cause
}

func writeFailure(args updaterArgs, err error) {
	if args.statusPath == "" {
		return
	}
	status := loadStatus(args.statusPath)
	if status.Status == "rolled_back" || status.Status == "manual_required" || status.Status == "succeeded" {
		return
	}
	phaseBeforeFailure := status.Phase
	status.Status = "failed"
	status.Phase = "failed"
	status.ErrorCode = "AGENT_UPGRADE_HELPER_FAILED"
	status.ErrorMessage = err.Error()
	if args.bootstrapURL != "" && (phaseBeforeFailure == "executing_script" || phaseBeforeFailure == "script_started") {
		status.Status = "manual_required"
		status.Phase = "manual_required"
		status.Rollback = "unknown"
		status.ErrorCode = "AGENT_UPGRADE_BOOTSTRAP_FAILED"
	}
	_ = saveStatus(args.statusPath, status)
}

func loadStatus(path string) upgradeStatus {
	content, err := os.ReadFile(path)
	if err != nil {
		return upgradeStatus{SchemaVersion: "management.upgrade.v1"}
	}
	var status upgradeStatus
	if json.Unmarshal(content, &status) != nil {
		return upgradeStatus{SchemaVersion: "management.upgrade.v1"}
	}
	return status
}

func saveStatus(path string, status upgradeStatus) error {
	status.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if status.ObservedAt == "" {
		status.ObservedAt = status.UpdatedAt
	}
	content, err := json.MarshalIndent(status, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary := path + fmt.Sprintf(".tmp-%d", os.Getpid())
	if err := os.WriteFile(temporary, append(content, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err == nil {
		return nil
	} else {
		// Windows 不允许 Rename 覆盖已存在文件；状态文件必须允许连续写入每个升级阶段。
		if removeErr := os.Remove(path); removeErr != nil && !os.IsNotExist(removeErr) {
			_ = os.Remove(temporary)
			return removeErr
		}
		if renameErr := os.Rename(temporary, path); renameErr != nil {
			_ = os.Remove(temporary)
			return renameErr
		}
		return nil
	}
}

func fail(err error) {
	_, _ = fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
