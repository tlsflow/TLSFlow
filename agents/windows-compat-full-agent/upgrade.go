package main

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	agentUpgradeSchemaVersion = "management.upgrade.v1"
	agentUpgradeProductLine   = "windows-compat-full-agent"
	agentUpgradeMaxArtifact   = int64(512 * 1024 * 1024)
)

var windowsGoRuntimeProfile = struct {
	productLine string
	platform    string
}{productLine: agentUpgradeProductLine, platform: "windows"}

var (
	agentUpgradeMu    sync.Mutex
	agentSemVerRegexp = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)
)

type agentUpgradeRelease struct {
	ReleaseID         string `json:"releaseId"`
	ProductLine       string `json:"productLine"`
	Version           string `json:"version"`
	Platform          string `json:"platform"`
	Architecture      string `json:"architecture"`
	DownloadURL       string `json:"downloadUrl"`
	ArtifactSHA256    string `json:"artifactSha256"`
	ArtifactSize      int64  `json:"artifactSize"`
	SignatureKeyID    string `json:"signatureKeyId"`
	ArtifactSignature string `json:"artifactSignature"`
}

type agentUpgradeEnvelope struct {
	SchemaVersion         string              `json:"schemaVersion"`
	PlanID                string              `json:"planId"`
	TransactionID         string              `json:"transactionId"`
	AgentID               string              `json:"agentId"`
	Release               agentUpgradeRelease `json:"release"`
	PolicyRef             string              `json:"policyRef,omitempty"`
	ApprovalRef           string              `json:"approvalRef,omitempty"`
	Nonce                 string              `json:"nonce"`
	IssuedAt              string              `json:"issuedAt"`
	ExpiresAt             string              `json:"expiresAt"`
	AuthorityKeyID        string              `json:"authorityKeyId"`
	ControlPlaneSignature string              `json:"controlPlaneSignature"`
}

type directUpgradeResponse struct {
	Success       bool           `json:"success"`
	Accepted      bool           `json:"accepted,omitempty"`
	ErrorCode     string         `json:"errorCode,omitempty"`
	ErrorMessage  string         `json:"errorMessage,omitempty"`
	TransactionID string         `json:"transactionId,omitempty"`
	Status        string         `json:"status,omitempty"`
	Detail        map[string]any `json:"detail,omitempty"`
}

type agentUpgradeStatus struct {
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

func executeLocalUpgrade(ctx context.Context, config *AgentConfig, registration *runtimeRegistration, payload map[string]any, logger *runtimeLogger) directUpgradeResponse {
	if config == nil || registration == nil {
		return directUpgradeResponse{ErrorCode: "AGENT_UPGRADE_UNAVAILABLE", ErrorMessage: "Agent 运行时尚未完成注册"}
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return directUpgradeResponse{ErrorCode: "AGENT_UPGRADE_INVALID", ErrorMessage: "升级请求编码失败"}
	}
	var envelope agentUpgradeEnvelope
	if err := json.Unmarshal(encoded, &envelope); err != nil {
		return directUpgradeResponse{ErrorCode: "AGENT_UPGRADE_INVALID", ErrorMessage: "升级请求格式无效"}
	}
	if err := validateUpgradeEnvelope(config, registration.AgentID, envelope); err != nil {
		return directUpgradeResponse{ErrorCode: upgradeValidationErrorCode(err), ErrorMessage: err.Error()}
	}

	statusPath := resolveUpgradeStatusPath(config)
	agentUpgradeMu.Lock()
	defer agentUpgradeMu.Unlock()
	current := loadUpgradeStatus(config)
	if current.TransactionID != "" {
		if current.TransactionID == envelope.TransactionID && current.ArtifactSHA256 == strings.ToLower(envelope.Release.ArtifactSHA256) {
			return directUpgradeResponse{Success: current.Status == "succeeded", Accepted: current.Status != "failed" && current.Status != "manual_required", TransactionID: current.TransactionID, Status: current.Status, Detail: map[string]any{"idempotent": true, "phase": current.Phase}}
		}
		if !isTerminalUpgradeStatus(current.Status) {
			return directUpgradeResponse{ErrorCode: "AGENT_UPGRADE_CONFLICT", ErrorMessage: "已有升级事务正在执行", TransactionID: current.TransactionID, Status: current.Status}
		}
	}
	if err := consumeUpgradeNonce(config, envelope.Nonce, envelope.TransactionID); err != nil {
		return directUpgradeResponse{ErrorCode: "AGENT_UPGRADE_AUTHORIZATION_DENIED", ErrorMessage: err.Error()}
	}

	status := agentUpgradeStatus{
		SchemaVersion:  agentUpgradeSchemaVersion,
		PlanID:         envelope.PlanID,
		TransactionID:  envelope.TransactionID,
		AgentID:        envelope.AgentID,
		FromVersion:    agentVersion,
		TargetVersion:  envelope.Release.Version,
		ArtifactSHA256: strings.ToLower(envelope.Release.ArtifactSHA256),
		Phase:          "downloading",
		Status:         "running",
		UpdatedAt:      time.Now().UTC().Format(time.RFC3339Nano),
		ObservedAt:     time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := saveUpgradeStatus(config, status); err != nil {
		return directUpgradeResponse{ErrorCode: "AGENT_UPGRADE_STATE_UNAVAILABLE", ErrorMessage: err.Error()}
	}

	artifactPath, err := downloadAndVerifyUpgradeArtifact(ctx, config, envelope.Release, envelope.TransactionID)
	if err != nil {
		status.Phase = "verification_failed"
		status.Status = "failed"
		status.ErrorCode = "ARTIFACT_INTEGRITY_FAILED"
		status.ErrorMessage = err.Error()
		_ = saveUpgradeStatus(config, status)
		return directUpgradeResponse{ErrorCode: status.ErrorCode, ErrorMessage: err.Error(), TransactionID: envelope.TransactionID, Status: status.Status}
	}
	status.Phase = "verified"
	if err := saveUpgradeStatus(config, status); err != nil {
		return directUpgradeResponse{ErrorCode: "AGENT_UPGRADE_STATE_UNAVAILABLE", ErrorMessage: err.Error()}
	}

	executable, err := os.Executable()
	if err != nil || strings.TrimSpace(executable) == "" {
		return failUpgradeBeforeLaunch(config, status, "AGENT_UPGRADE_TARGET_UNAVAILABLE", "读取当前 Agent 可执行文件路径失败")
	}
	updaterPath := filepath.Join(filepath.Dir(executable), "gcac-agent-updater.exe")
	if !fileExists(updaterPath) {
		return failUpgradeBeforeLaunch(config, status, "AGENT_UPGRADE_HELPER_UNAVAILABLE", "升级器 gcac-agent-updater.exe 不存在")
	}
	publicKey := strings.TrimSpace(config.ReleaseTrustKeySet[envelope.Release.SignatureKeyID])
	if len(config.ReleaseTrustKeySet) > 0 && publicKey == "" {
		return failUpgradeBeforeLaunch(config, status, "AGENT_UPGRADE_RELEASE_INVALID", "升级发布公钥未配置")
	}
	backupPath := executable + ".rollback-" + sanitizeUpgradeID(envelope.TransactionID) + ".exe"
	status.Phase = "launching"
	if err := saveUpgradeStatus(config, status); err != nil {
		return directUpgradeResponse{ErrorCode: "AGENT_UPGRADE_STATE_UNAVAILABLE", ErrorMessage: err.Error()}
	}
	command := exec.Command(updaterPath,
		"--artifact", artifactPath,
		"--target", executable,
		"--backup", backupPath,
		"--service", config.Service.Name,
		"--status", statusPath,
		"--transaction-id", envelope.TransactionID,
		"--plan-id", envelope.PlanID,
		"--agent-id", envelope.AgentID,
		"--from-version", agentVersion,
		"--to-version", envelope.Release.Version,
		"--expected-sha256", strings.ToLower(envelope.Release.ArtifactSHA256),
		"--artifact-signature", envelope.Release.ArtifactSignature,
		"--release-public-key", publicKey,
		"--release-key-id", envelope.Release.SignatureKeyID,
		"--health-port", fmt.Sprintf("%d", effectiveManagementPort(config)),
		"--health-timeout-seconds", "90",
	)
	command.Dir = filepath.Dir(updaterPath)
	if err := command.Start(); err != nil {
		status.Phase = "helper_start_failed"
		status.Status = "failed"
		status.ErrorCode = "AGENT_UPGRADE_HELPER_START_FAILED"
		status.ErrorMessage = err.Error()
		_ = saveUpgradeStatus(config, status)
		return directUpgradeResponse{ErrorCode: status.ErrorCode, ErrorMessage: err.Error(), TransactionID: envelope.TransactionID, Status: status.Status}
	}
	status.Phase = "helper_started"
	_ = saveUpgradeStatus(config, status)
	if logger != nil {
		logger.Info("local upgrade helper started transaction=%s targetVersion=%s", envelope.TransactionID, envelope.Release.Version)
	}
	return directUpgradeResponse{Success: true, Accepted: true, TransactionID: envelope.TransactionID, Status: "accepted", Detail: map[string]any{"phase": status.Phase, "targetVersion": envelope.Release.Version}}
}

func validateUpgradeEnvelope(config *AgentConfig, agentID string, envelope agentUpgradeEnvelope) error {
	if envelope.SchemaVersion != agentUpgradeSchemaVersion || strings.TrimSpace(envelope.PlanID) == "" || strings.TrimSpace(envelope.TransactionID) == "" || strings.TrimSpace(envelope.Nonce) == "" {
		return errors.New("升级信封缺少版本、计划、事务或 Nonce")
	}
	if envelope.AgentID != agentID {
		return errors.New("升级信封 Agent 身份不匹配")
	}
	if err := validateUpgradeTimeWindow(envelope.IssuedAt, envelope.ExpiresAt); err != nil {
		return err
	}
	release := envelope.Release
	profile := windowsGoRuntimeProfile
	if release.ProductLine != profile.productLine || release.Platform != profile.platform || release.Architecture != "amd64" || release.Architecture != currentWindowsArchitecture() {
		return errors.New("升级发布物与 Windows Go Agent 运行基线不匹配")
	}
	if !agentSemVerRegexp.MatchString(release.Version) || release.Version == agentVersion {
		return errors.New("升级目标版本无效或与当前版本相同")
	}
	if release.ReleaseID == "" || !isAgentDigest(strings.ToLower(release.ArtifactSHA256)) || release.ArtifactSize <= 0 || release.ArtifactSize > agentUpgradeMaxArtifact || (len(config.ReleaseTrustKeySet) > 0 && (release.SignatureKeyID == "" || release.ArtifactSignature == "")) {
		return errors.New("升级发布物摘要、大小或签名材料无效")
	}
	downloadURL, err := url.Parse(strings.TrimSpace(release.DownloadURL))
	if err != nil || (downloadURL.Scheme != "http" && downloadURL.Scheme != "https") || downloadURL.Host == "" || downloadURL.User != nil {
		return errors.New("升级发布物下载地址必须是 HTTP(S) 地址")
	}
	if len(config.UpgradeTrustKeySet) > 0 {
		if err := verifyUpgradeSignature(envelope.AuthorityKeyID, envelope.ControlPlaneSignature, upgradeEnvelopeWithoutSignature(envelope), config.UpgradeTrustKeySet); err != nil {
			return fmt.Errorf("升级信封签名无效: %w", err)
		}
	}
	if strings.TrimSpace(release.ArtifactSignature) != "" {
		if _, err := decodeUpgradeSignature(release.ArtifactSignature); err != nil {
			return fmt.Errorf("升级发布签名格式无效: %w", err)
		}
	}
	return nil
}

func validateUpgradeTimeWindow(issuedAtValue, expiresAtValue string) error {
	issuedAt, issuedErr := time.Parse(time.RFC3339Nano, issuedAtValue)
	expiresAt, expiresErr := time.Parse(time.RFC3339Nano, expiresAtValue)
	now := time.Now()
	if issuedErr != nil || expiresErr != nil || issuedAt.After(now.Add(maxAuthorizationClockSkew)) || !now.Before(expiresAt) || !expiresAt.After(issuedAt) || expiresAt.Sub(issuedAt) > 15*time.Minute {
		return errors.New("升级信封时间窗口无效或已过期")
	}
	return nil
}

func verifyUpgradeSignature(keyID, signature string, value []byte, keySet map[string]string) error {
	encodedKey := strings.TrimSpace(keySet[keyID])
	if keyID == "" || encodedKey == "" || strings.TrimSpace(signature) == "" {
		return errors.New("签名或信任公钥缺失")
	}
	publicKey, err := decodeUpgradeKey(encodedKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return errors.New("信任公钥无效")
	}
	signed, err := decodeUpgradeSignature(signature)
	if err != nil || !ed25519.Verify(ed25519.PublicKey(publicKey), value, signed) {
		return errors.New("签名验证失败")
	}
	return nil
}

func decodeUpgradeKey(value string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil {
		decoded, err = base64.StdEncoding.DecodeString(strings.TrimSpace(value))
	}
	return decoded, err
}

func decodeUpgradeSignature(value string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil {
		decoded, err = base64.StdEncoding.DecodeString(strings.TrimSpace(value))
	}
	if err != nil {
		return nil, err
	}
	if len(decoded) != ed25519.SignatureSize {
		return nil, fmt.Errorf("Ed25519 签名长度无效: %d", len(decoded))
	}
	return decoded, nil
}

func verifyUpgradeArtifactSignature(path, keyID, signature string, keySet map[string]string) error {
	encodedKey := strings.TrimSpace(keySet[keyID])
	if keyID == "" || encodedKey == "" {
		return errors.New("升级发布公钥缺失")
	}
	publicKey, err := decodeUpgradeKey(encodedKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return errors.New("升级发布公钥无效")
	}
	signed, err := decodeUpgradeSignature(signature)
	if err != nil {
		return fmt.Errorf("升级发布签名无效: %w", err)
	}
	artifact, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("读取升级制品进行签名校验失败: %w", err)
	}
	if len(artifact) == 0 || int64(len(artifact)) > agentUpgradeMaxArtifact {
		return errors.New("升级制品大小无效")
	}
	if !ed25519.Verify(ed25519.PublicKey(publicKey), artifact, signed) {
		return errors.New("升级发布签名校验失败")
	}
	return nil
}

func upgradeEnvelopeWithoutSignature(envelope agentUpgradeEnvelope) []byte {
	value := map[string]any{
		"schemaVersion": envelope.SchemaVersion,
		"planId":        envelope.PlanID,
		"transactionId": envelope.TransactionID,
		"agentId":       envelope.AgentID,
		"release": map[string]any{
			"releaseId": envelope.Release.ReleaseID, "productLine": envelope.Release.ProductLine,
			"version": envelope.Release.Version, "platform": envelope.Release.Platform,
			"architecture": envelope.Release.Architecture, "downloadUrl": envelope.Release.DownloadURL,
			"artifactSha256": envelope.Release.ArtifactSHA256, "artifactSize": envelope.Release.ArtifactSize,
			"signatureKeyId": envelope.Release.SignatureKeyID, "artifactSignature": envelope.Release.ArtifactSignature,
		},
		"policyRef": envelope.PolicyRef, "approvalRef": envelope.ApprovalRef, "nonce": envelope.Nonce,
		"issuedAt": envelope.IssuedAt, "expiresAt": envelope.ExpiresAt, "authorityKeyId": envelope.AuthorityKeyID,
	}
	return []byte(stableJSON(value))
}

func downloadAndVerifyUpgradeArtifact(ctx context.Context, config *AgentConfig, release agentUpgradeRelease, transactionID string) (string, error) {
	directory := filepath.Join(config.Paths.Windows.DataDir, "upgrades")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", fmt.Errorf("创建升级临时目录失败: %w", err)
	}
	path := filepath.Join(directory, sanitizeUpgradeID(transactionID)+".artifact")
	_ = os.Remove(path)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, release.DownloadURL, nil)
	if err != nil {
		return "", fmt.Errorf("创建升级下载请求失败: %w", err)
	}
	client := &http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return errors.New("升级下载禁止重定向") }}
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("下载升级制品失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载升级制品返回 HTTP %d", response.StatusCode)
	}
	if response.ContentLength > agentUpgradeMaxArtifact || response.ContentLength > 0 && response.ContentLength != release.ArtifactSize {
		return "", errors.New("升级制品大小与 Release 不匹配")
	}
	temporary := path + ".tmp"
	file, err := os.OpenFile(temporary, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", fmt.Errorf("创建升级制品临时文件失败: %w", err)
	}
	hash := sha256.New()
	limited := io.LimitReader(io.TeeReader(response.Body, hash), agentUpgradeMaxArtifact+1)
	written, copyErr := io.Copy(file, limited)
	syncErr := file.Sync()
	closeErr := file.Close()
	if copyErr != nil || syncErr != nil || closeErr != nil || written != release.ArtifactSize {
		_ = os.Remove(temporary)
		return "", errors.New("升级制品下载不完整或无法持久化")
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	if !strings.EqualFold(digest, release.ArtifactSHA256) {
		_ = os.Remove(temporary)
		return "", errors.New("升级制品 SHA-256 校验失败")
	}
	if len(config.ReleaseTrustKeySet) > 0 {
		if err := verifyUpgradeArtifactSignature(temporary, release.SignatureKeyID, release.ArtifactSignature, config.ReleaseTrustKeySet); err != nil {
			_ = os.Remove(temporary)
			return "", err
		}
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return "", fmt.Errorf("保存升级制品失败: %w", err)
	}
	return path, nil
}

func consumeUpgradeNonce(config *AgentConfig, nonce, transactionID string) error {
	directory := filepath.Join(config.Paths.Windows.DataDir, "upgrades", "nonces")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("创建升级 Nonce 目录失败: %w", err)
	}
	digest := sha256.Sum256([]byte(strings.TrimSpace(nonce)))
	path := filepath.Join(directory, hex.EncodeToString(digest[:])+".json")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o600)
	if err != nil {
		if os.IsExist(err) {
			return errors.New("升级 Nonce 已消费，拒绝重放")
		}
		return fmt.Errorf("创建升级 Nonce 记录失败: %w", err)
	}
	defer file.Close()
	_, err = file.Write([]byte(fmt.Sprintf("{\"transactionId\":%q,\"consumedAt\":%q}\n", transactionID, time.Now().UTC().Format(time.RFC3339Nano))))
	if err != nil {
		_ = os.Remove(path)
		return fmt.Errorf("写入升级 Nonce 记录失败: %w", err)
	}
	return file.Sync()
}

func resolveUpgradeStatusPath(config *AgentConfig) string {
	return filepath.Join(config.Paths.Windows.DataDir, "upgrades", "status.json")
}

func loadUpgradeStatus(config *AgentConfig) agentUpgradeStatus {
	content, err := os.ReadFile(resolveUpgradeStatusPath(config))
	if err != nil {
		return agentUpgradeStatus{SchemaVersion: agentUpgradeSchemaVersion, Status: "idle"}
	}
	var status agentUpgradeStatus
	if json.Unmarshal(content, &status) != nil || status.SchemaVersion != agentUpgradeSchemaVersion {
		return agentUpgradeStatus{SchemaVersion: agentUpgradeSchemaVersion, Status: "manual_required", ErrorCode: "AGENT_UPGRADE_STATE_INVALID"}
	}
	return status
}

func saveUpgradeStatus(config *AgentConfig, status agentUpgradeStatus) error {
	status.SchemaVersion = agentUpgradeSchemaVersion
	status.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if status.ObservedAt == "" {
		status.ObservedAt = status.UpdatedAt
	}
	return atomicWriteJSON(resolveUpgradeStatusPath(config), status)
}

func failUpgradeBeforeLaunch(config *AgentConfig, status agentUpgradeStatus, code, message string) directUpgradeResponse {
	status.Status = "failed"
	status.Phase = "rejected"
	status.ErrorCode = code
	status.ErrorMessage = message
	_ = saveUpgradeStatus(config, status)
	return directUpgradeResponse{ErrorCode: code, ErrorMessage: message, TransactionID: status.TransactionID, Status: status.Status}
}

func writeUpgradeStatusResponse(writer http.ResponseWriter, status agentUpgradeStatus) {
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode(status)
}

func isTerminalUpgradeStatus(status string) bool {
	return status == "succeeded" || status == "failed" || status == "rolled_back" || status == "manual_required"
}

func upgradeValidationErrorCode(err error) string {
	if strings.Contains(err.Error(), "信封签名") || strings.Contains(err.Error(), "时间窗口") || strings.Contains(err.Error(), "Nonce") {
		return "AGENT_UPGRADE_AUTHORIZATION_DENIED"
	}
	if strings.Contains(err.Error(), "发布签名") || strings.Contains(err.Error(), "发布物") || strings.Contains(err.Error(), "HTTPS") {
		return "AGENT_UPGRADE_RELEASE_INVALID"
	}
	return "AGENT_UPGRADE_INVALID"
}

func sanitizeUpgradeID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "transaction"
	}
	var builder strings.Builder
	for _, character := range value {
		if character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || character == '-' || character == '_' {
			builder.WriteRune(character)
		}
	}
	if builder.Len() == 0 {
		return "transaction"
	}
	return builder.String()
}

func currentWindowsArchitecture() string {
	if strings.EqualFold(os.Getenv("PROCESSOR_ARCHITEW6432"), "AMD64") || strings.EqualFold(os.Getenv("PROCESSOR_ARCHITECTURE"), "AMD64") {
		return "amd64"
	}
	if strings.EqualFold(os.Getenv("PROCESSOR_ARCHITEW6432"), "ARM64") || strings.EqualFold(os.Getenv("PROCESSOR_ARCHITECTURE"), "ARM64") {
		return "arm64"
	}
	return runtime.GOARCH
}
