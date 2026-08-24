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
	"strconv"
	"strings"
	"time"
)

const (
	agentUpgradeSchemaVersion  = "management.upgrade.v1"
	agentUpgradeProductLine    = "linux-go-full"
	agentUpgradeMaxArtifact    = int64(512 * 1024 * 1024)
	agentUpgradeReconcileGrace = 30 * time.Second
	agentUpgradeHelperTimeout  = 5 * time.Minute
)

var agentUpgradeMu = make(chan struct{}, 1)
var agentSemVerRegexp = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)

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
	UpgradeBootstrapURL   string              `json:"upgradeBootstrapUrl,omitempty"`
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

// executeLocalUpgrade 只负责授权并启动控制面下发的 Linux bootstrap 脚本。
// 文件替换和服务切换由现有 agent-install 脚本完成，避免依赖当前 Agent 的 helper。
func executeLocalUpgrade(ctx context.Context, config *AgentConfig, registration *runtimeState, payload map[string]any) directUpgradeResponse {
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
	if os.Geteuid() != 0 {
		return directUpgradeResponse{ErrorCode: "AGENT_UPGRADE_PERMISSION_DENIED", ErrorMessage: "Linux 本地升级需要 root 权限，当前 Agent 服务账户无权停止服务或替换安装文件"}
	}

	agentUpgradeMu <- struct{}{}
	defer func() { <-agentUpgradeMu }()
	current := reconcileCompletedUpgradeStatus(config, loadUpgradeStatus(config))
	if current.TransactionID != "" {
		if current.TransactionID == envelope.TransactionID && current.ArtifactSHA256 == strings.ToLower(envelope.Release.ArtifactSHA256) {
			return directUpgradeResponse{Success: current.Status == "succeeded", Accepted: !isTerminalUpgradeFailure(current.Status), TransactionID: current.TransactionID, Status: current.Status, Detail: map[string]any{"idempotent": true, "phase": current.Phase}}
		}
		if !isTerminalUpgradeStatus(current.Status) {
			return directUpgradeResponse{ErrorCode: "AGENT_UPGRADE_CONFLICT", ErrorMessage: "已有升级事务正在执行", TransactionID: current.TransactionID, Status: current.Status}
		}
	}
	if err := consumeUpgradeNonce(config, envelope.Nonce, envelope.TransactionID); err != nil {
		return directUpgradeResponse{ErrorCode: "AGENT_UPGRADE_AUTHORIZATION_DENIED", ErrorMessage: err.Error()}
	}

	status := agentUpgradeStatus{
		SchemaVersion: agentUpgradeSchemaVersion, PlanID: envelope.PlanID, TransactionID: envelope.TransactionID,
		AgentID: envelope.AgentID, FromVersion: agentVersion, TargetVersion: envelope.Release.Version,
		ArtifactSHA256: strings.ToLower(envelope.Release.ArtifactSHA256), Phase: "downloading", Status: "running",
		ObservedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := saveUpgradeStatus(config, status); err != nil {
		return directUpgradeResponse{ErrorCode: "AGENT_UPGRADE_STATE_UNAVAILABLE", ErrorMessage: err.Error()}
	}
	if strings.TrimSpace(envelope.UpgradeBootstrapURL) == "" {
		return failUpgradeBeforeLaunch(config, status, "AGENT_UPGRADE_BOOTSTRAP_UNAVAILABLE", "Linux 升级缺少 bootstrap 安装脚本地址")
	}
	// 先落账再启动脚本。脚本会在重启当前服务前写入新的 systemd unit，
	// 因此不会依赖旧 Agent 的 helper 脱离 cgroup。
	status.Phase, status.Status = "script_started", "running"
	if err := saveUpgradeStatus(config, status); err != nil {
		return directUpgradeResponse{ErrorCode: "AGENT_UPGRADE_STATE_UNAVAILABLE", ErrorMessage: err.Error()}
	}
	upgradeEnv := []string{
		"UPGRADE_STATUS_PATH=" + resolveUpgradeStatusPath(config),
		"UPGRADE_PLAN_ID=" + envelope.PlanID,
		"UPGRADE_TRANSACTION_ID=" + envelope.TransactionID,
		"UPGRADE_AGENT_ID=" + envelope.AgentID,
		"UPGRADE_FROM_VERSION=" + status.FromVersion,
		"UPGRADE_TARGET_VERSION=" + status.TargetVersion,
		"UPGRADE_ARTIFACT_SHA256=" + status.ArtifactSHA256,
		"UPGRADE_BOOTSTRAP_URL=" + envelope.UpgradeBootstrapURL,
	}
	if err := startLinuxUpgradeBootstrap(config, upgradeEnv, envelope.TransactionID); err != nil {
		return failUpgradeBeforeLaunch(config, status, "AGENT_UPGRADE_SCRIPT_START_FAILED", err.Error())
	}
	return directUpgradeResponse{Success: true, Accepted: true, TransactionID: status.TransactionID, Status: "accepted", Detail: map[string]any{"phase": status.Phase, "targetVersion": status.TargetVersion, "transport": "bootstrap_script"}}
}

// startLinuxUpgradeBootstrap 复用用户手工执行的 curl | bash 安装路径。
// 当前 Agent 只负责启动脚本并立即返回；bootstrap 会先写入新的 systemd unit，
// 再重启服务，所以旧服务停止时不会把脚本一起清理。
func startLinuxUpgradeBootstrap(config *AgentConfig, environment []string, transactionID string) error {
	if config == nil {
		return errors.New("Agent 配置不能为空")
	}
	bashPath, err := exec.LookPath("bash")
	if err != nil {
		return errors.New("Linux 升级需要 bash")
	}
	if _, err := exec.LookPath("curl"); err != nil {
		return errors.New("Linux 升级需要 curl")
	}
	directory := filepath.Join(config.Paths.Linux.DataDir, "upgrades")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("创建升级脚本目录失败: %w", err)
	}
	scriptPath := filepath.Join(directory, sanitizeUpgradeID(transactionID)+".bootstrap.sh")
	script := `#!/usr/bin/env bash
set -euo pipefail

STATUS_PATH="${UPGRADE_STATUS_PATH:-}"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g; s/$/\\n/' | sed '$ s/\\n$//'
}

write_status() {
  status_value="$1"
  phase_value="$2"
  error_code_value="${3:-}"
  error_message_value="${4:-}"
  rollback_value="${5:-}"
  [ -n "${STATUS_PATH}" ] || return 0
  mkdir -p "$(dirname "${STATUS_PATH}")"
  status_tmp="${STATUS_PATH}.tmp.$$"
  printf '{"schemaVersion":"management.upgrade.v1","planId":"%s","transactionId":"%s","agentId":"%s","fromVersion":"%s","targetVersion":"%s","artifactSha256":"%s","phase":"%s","status":"%s","errorCode":"%s","errorMessage":"%s","rollback":"%s","updatedAt":"%s","observedAt":"%s"}\n' \
    "$(json_escape "${UPGRADE_PLAN_ID:-}")" "$(json_escape "${UPGRADE_TRANSACTION_ID:-}")" "$(json_escape "${UPGRADE_AGENT_ID:-}")" \
    "$(json_escape "${UPGRADE_FROM_VERSION:-}")" "$(json_escape "${UPGRADE_TARGET_VERSION:-}")" "$(json_escape "${UPGRADE_ARTIFACT_SHA256:-}")" \
    "$(json_escape "${phase_value}")" "$(json_escape "${status_value}")" "$(json_escape "${error_code_value}")" "$(json_escape "${error_message_value}")" "$(json_escape "${rollback_value}")" \
    "$(date -u '+%Y-%m-%dT%H:%M:%S%NZ')" "$(date -u '+%Y-%m-%dT%H:%M:%S%NZ')" > "${status_tmp}"
  chmod 0600 "${status_tmp}"
  mv -f "${status_tmp}" "${STATUS_PATH}"
}

write_status running script_started
if curl -fsSL --max-time 600 "${UPGRADE_BOOTSTRAP_URL}" | bash; then
  write_status succeeded verified "" "" "not_required"
  rm -f -- "$0"
else
  exit_code="$?"
  write_status failed script_failed AGENT_UPGRADE_BOOTSTRAP_FAILED "bootstrap 安装脚本执行失败，退出码=${exit_code}" "unknown"
  exit "${exit_code}"
fi
`
	if err := os.WriteFile(scriptPath, []byte(script), 0o700); err != nil {
		return fmt.Errorf("写入升级 bootstrap 脚本失败: %w", err)
	}
	command := exec.Command(bashPath, scriptPath)
	command.Dir = directory
	command.Env = append(os.Environ(), environment...)
	command.Stdout = os.Stderr
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		_ = os.Remove(scriptPath)
		return fmt.Errorf("启动升级 bootstrap 脚本失败: %w", err)
	}
	return nil
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
	if release.ProductLine != agentUpgradeProductLine || release.Platform != "linux" || release.Architecture != currentLinuxArchitecture() {
		return errors.New("升级发布物与 Linux Go Agent 运行基线不匹配")
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
	if release.Platform == "linux" {
		bootstrapURL, bootstrapErr := url.Parse(strings.TrimSpace(envelope.UpgradeBootstrapURL))
		if bootstrapErr != nil || (bootstrapURL.Scheme != "http" && bootstrapURL.Scheme != "https") || bootstrapURL.Host == "" || bootstrapURL.User != nil {
			return errors.New("Linux 升级 bootstrap 地址必须是 HTTP(S) 地址")
		}
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
	publicKey, err := decodeUpgradeKey(strings.TrimSpace(keySet[keyID]))
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
	if len(artifact) == 0 || int64(len(artifact)) > agentUpgradeMaxArtifact || !ed25519.Verify(ed25519.PublicKey(publicKey), artifact, signed) {
		return errors.New("升级发布签名校验失败")
	}
	return nil
}

func upgradeEnvelopeWithoutSignature(envelope agentUpgradeEnvelope) []byte {
	value := map[string]any{
		"schemaVersion": envelope.SchemaVersion, "planId": envelope.PlanID, "transactionId": envelope.TransactionID, "agentId": envelope.AgentID,
		"release":   map[string]any{"releaseId": envelope.Release.ReleaseID, "productLine": envelope.Release.ProductLine, "version": envelope.Release.Version, "platform": envelope.Release.Platform, "architecture": envelope.Release.Architecture, "downloadUrl": envelope.Release.DownloadURL, "artifactSha256": envelope.Release.ArtifactSHA256, "artifactSize": envelope.Release.ArtifactSize, "signatureKeyId": envelope.Release.SignatureKeyID, "artifactSignature": envelope.Release.ArtifactSignature},
		"policyRef": envelope.PolicyRef, "approvalRef": envelope.ApprovalRef, "nonce": envelope.Nonce, "issuedAt": envelope.IssuedAt, "expiresAt": envelope.ExpiresAt, "authorityKeyId": envelope.AuthorityKeyID,
	}
	if strings.TrimSpace(envelope.UpgradeBootstrapURL) != "" {
		value["upgradeBootstrapUrl"] = envelope.UpgradeBootstrapURL
	}
	return stableUpgradeJSON(value)
}

func stableUpgradeJSON(value any) []byte {
	encoded, _ := json.Marshal(value)
	return encoded
}

func downloadAndVerifyUpgradeArtifact(ctx context.Context, config *AgentConfig, release agentUpgradeRelease, transactionID string) (string, error) {
	directory := filepath.Join(config.Paths.Linux.DataDir, "upgrades")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", fmt.Errorf("创建升级临时目录失败: %w", err)
	}
	path := filepath.Join(directory, sanitizeUpgradeID(transactionID)+".artifact")
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, release.DownloadURL, nil)
	if err != nil {
		return "", fmt.Errorf("创建升级下载请求失败: %w", err)
	}
	response, err := (&http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("升级下载禁止重定向") }}).Do(request)
	if err != nil {
		return "", fmt.Errorf("下载升级制品失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || (response.ContentLength > 0 && response.ContentLength != release.ArtifactSize) {
		return "", fmt.Errorf("下载升级制品返回 HTTP %d 或大小不匹配", response.StatusCode)
	}
	temporary := path + ".tmp"
	file, err := os.OpenFile(temporary, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", fmt.Errorf("创建升级制品临时文件失败: %w", err)
	}
	hash := sha256.New()
	written, copyErr := io.Copy(file, io.LimitReader(io.TeeReader(response.Body, hash), agentUpgradeMaxArtifact+1))
	syncErr, closeErr := file.Sync(), file.Close()
	if copyErr != nil || syncErr != nil || closeErr != nil || written != release.ArtifactSize {
		_ = os.Remove(temporary)
		return "", errors.New("升级制品下载不完整或无法持久化")
	}
	if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), release.ArtifactSHA256) {
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
	directory := filepath.Join(config.Paths.Linux.DataDir, "upgrades", "nonces")
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
	_, err = fmt.Fprintf(file, "{\"transactionId\":%q,\"consumedAt\":%q}\n", transactionID, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		_ = os.Remove(path)
		return fmt.Errorf("写入升级 Nonce 记录失败: %w", err)
	}
	return file.Sync()
}

func resolveUpgradeStatusPath(config *AgentConfig) string {
	return filepath.Join(config.Paths.Linux.DataDir, "upgrades", "status.json")
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

// reconcileCompletedUpgradeStatus 处理 Agent 已经运行新版本、但旧 helper 来不及
// 写入最终回执的情况。只有当前进程版本不低于事务目标版本，且回执已经越过启动宽限期时
// 才允许补记成功，避免把仍在替换中的事务误判为完成。
func reconcileCompletedUpgradeStatus(config *AgentConfig, status agentUpgradeStatus) agentUpgradeStatus {
	if status.Status != "running" || status.TransactionID == "" || !agentVersionAtLeast(agentVersion, status.TargetVersion) {
		return reconcileStaleLinuxUpgradeHelper(config, status)
	}
	if status.Phase != "helper_started" && status.Phase != "replaced" && status.Phase != "verified" {
		return status
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, status.UpdatedAt)
	if err != nil || time.Since(updatedAt) < agentUpgradeReconcileGrace {
		return status
	}
	status.Status = "succeeded"
	status.Phase = "verified"
	status.Rollback = "not_required"
	status.ErrorCode = ""
	status.ErrorMessage = ""
	if err := saveUpgradeStatus(config, status); err != nil {
		return loadUpgradeStatus(config)
	}
	return status
}

// reconcileStaleLinuxUpgradeHelper 防止 helper 被服务管理器清理后永久停在 running。
// 结果未知时只能停止自动动作并要求人工确认，不能继续重放替换事务。
func reconcileStaleLinuxUpgradeHelper(config *AgentConfig, status agentUpgradeStatus) agentUpgradeStatus {
	if status.Status != "running" || status.TransactionID == "" || status.Phase != "helper_started" {
		return status
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, status.UpdatedAt)
	if err != nil || time.Since(updatedAt) < agentUpgradeHelperTimeout {
		return status
	}
	status.Status = "manual_required"
	status.Phase = "manual_required"
	status.ErrorCode = "AGENT_UPGRADE_HELPER_TIMEOUT"
	status.ErrorMessage = "升级 helper 超时且当前版本未达到目标版本，禁止自动重试，需要人工确认服务和文件状态"
	status.Rollback = "unknown"
	if err := saveUpgradeStatus(config, status); err != nil {
		return loadUpgradeStatus(config)
	}
	return status
}

func agentVersionAtLeast(currentVersion, targetVersion string) bool {
	current, currentOK := parseAgentVersionCore(currentVersion)
	target, targetOK := parseAgentVersionCore(targetVersion)
	if !currentOK || !targetOK {
		return false
	}
	for index := 0; index < len(current); index++ {
		if current[index] != target[index] {
			return current[index] > target[index]
		}
	}
	return true
}

func parseAgentVersionCore(value string) ([3]int, bool) {
	var result [3]int
	value = strings.TrimPrefix(strings.TrimSpace(value), "v")
	if separator := strings.IndexAny(value, "-+"); separator >= 0 {
		value = value[:separator]
	}
	parts := strings.Split(value, ".")
	if len(parts) != 3 {
		return result, false
	}
	for index, part := range parts {
		if part == "" {
			return result, false
		}
		parsed, err := strconv.Atoi(part)
		if err != nil || parsed < 0 {
			return result, false
		}
		result[index] = parsed
	}
	return result, true
}

func saveUpgradeStatus(config *AgentConfig, status agentUpgradeStatus) error {
	status.SchemaVersion = agentUpgradeSchemaVersion
	status.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if status.ObservedAt == "" {
		status.ObservedAt = status.UpdatedAt
	}
	return atomicWriteUpgradeJSON(resolveUpgradeStatusPath(config), status)
}

func atomicWriteUpgradeJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary := path + ".tmp"
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err := os.WriteFile(temporary, encoded, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func failUpgradeBeforeLaunch(config *AgentConfig, status agentUpgradeStatus, code, message string) directUpgradeResponse {
	status.Status, status.Phase, status.ErrorCode, status.ErrorMessage = "failed", "rejected", code, message
	_ = saveUpgradeStatus(config, status)
	return directUpgradeResponse{ErrorCode: code, ErrorMessage: message, TransactionID: status.TransactionID, Status: status.Status}
}

func writeUpgradeStatusResponse(writer http.ResponseWriter, status agentUpgradeStatus) {
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode(status)
}

func writeUpgradeResponse(writer http.ResponseWriter, status int, response directUpgradeResponse) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(response)
}

func directUpgradeHTTPStatus(response directUpgradeResponse) int {
	if response.Success || response.Accepted {
		return http.StatusOK
	}
	switch response.ErrorCode {
	case "AGENT_UPGRADE_CONFLICT", "AGENT_UPGRADE_STATUS_IDENTITY_MISMATCH":
		return http.StatusConflict
	case "AGENT_UPGRADE_AUTHORIZATION_DENIED", "AGENT_UPGRADE_RELEASE_INVALID", "AGENT_UPGRADE_PERMISSION_DENIED":
		return http.StatusForbidden
	case "AGENT_UPGRADE_UNAVAILABLE":
		return http.StatusServiceUnavailable
	default:
		return http.StatusBadRequest
	}
}

func isTerminalUpgradeStatus(status string) bool {
	return status == "succeeded" || status == "failed" || status == "rolled_back" || status == "unknown" || status == "manual_required"
}

func isTerminalUpgradeFailure(status string) bool {
	return status == "failed" || status == "rolled_back" || status == "unknown" || status == "manual_required"
}

func upgradeValidationErrorCode(err error) string {
	message := err.Error()
	if strings.Contains(message, "信封签名") || strings.Contains(message, "时间窗口") || strings.Contains(message, "Nonce") {
		return "AGENT_UPGRADE_AUTHORIZATION_DENIED"
	}
	if strings.Contains(message, "发布签名") || strings.Contains(message, "发布物") || strings.Contains(message, "HTTP(S)") {
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

func currentLinuxArchitecture() string {
	switch runtime.GOARCH {
	case "amd64":
		return "amd64"
	case "arm64":
		return "arm64"
	default:
		return runtime.GOARCH
	}
}

func findLinuxUpgradeScript(executable string) string {
	candidates := []string{
		strings.TrimSpace(os.Getenv("GCAC_LINUX_UPGRADE_SCRIPT")),
		filepath.Join(filepath.Dir(executable), "upgrade.sh"),
		filepath.Join(filepath.Dir(executable), "linux", "upgrade.sh"),
		"/usr/lib/gcac/linux-agent/upgrade.sh",
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
			return candidate
		}
	}
	return ""
}
