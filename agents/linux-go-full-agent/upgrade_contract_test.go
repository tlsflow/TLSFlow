package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"testing"
	"time"
)

func TestValidateLinuxUpgradeEnvelopeRejectsInvalidRelease(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	publicKeyValue := base64.StdEncoding.EncodeToString(publicKey)
	config := &AgentConfig{
		UpgradeTrustKeySet: map[string]string{"control": publicKeyValue},
		ReleaseTrustKeySet: map[string]string{"release": publicKeyValue},
	}
	now := time.Now().UTC()
	envelope := agentUpgradeEnvelope{
		SchemaVersion: agentUpgradeSchemaVersion,
		PlanID:        "plan-1", TransactionID: "transaction-1", AgentID: "agent-1", Nonce: "nonce-1",
		IssuedAt: now.Add(-time.Minute).Format(time.RFC3339Nano), ExpiresAt: now.Add(time.Minute).Format(time.RFC3339Nano),
		AuthorityKeyID: "control",
		Release: agentUpgradeRelease{
			ReleaseID: "release-1", ProductLine: agentUpgradeProductLine, Version: "0.2.0", Platform: "linux",
			Architecture: currentLinuxArchitecture(), DownloadURL: "ftp://invalid.example/agent",
			ArtifactSHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", ArtifactSize: 100,
			SignatureKeyID: "release", ArtifactSignature: "placeholder",
		},
	}
	envelope.ControlPlaneSignature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, upgradeEnvelopeWithoutSignature(envelope)))
	if err := validateUpgradeEnvelope(config, "agent-1", envelope); err == nil {
		t.Fatal("非 HTTP(S) 下载地址必须被拒绝")
	}
	envelope.Release.DownloadURL = "https://release.example/agent"
	envelope.Release.Version = agentVersion
	envelope.ControlPlaneSignature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, upgradeEnvelopeWithoutSignature(envelope)))
	if err := validateUpgradeEnvelope(config, "agent-1", envelope); err == nil {
		t.Fatal("当前版本目标必须被拒绝")
	}
}

func TestLinuxUpgradeEnvelopeSignatureRoundTrip(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	value := []byte("artifact-digest")
	signature := base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, value))
	keySet := map[string]string{"release": base64.StdEncoding.EncodeToString(publicKey)}
	if err := verifyUpgradeSignature("release", signature, value, keySet); err != nil {
		t.Fatalf("签名回放失败: %v", err)
	}
	if err := verifyUpgradeSignature("release", signature, []byte("other-digest"), keySet); err == nil {
		t.Fatal("签名内容被篡改时必须失败")
	}
}

func TestValidateLinuxUpgradeEnvelopeAllowsUnsignedHTTPForDevelopment(t *testing.T) {
	now := time.Now().UTC()
	envelope := agentUpgradeEnvelope{
		SchemaVersion: agentUpgradeSchemaVersion,
		PlanID:        "plan-dev", TransactionID: "transaction-dev", AgentID: "agent-dev", Nonce: "nonce-dev",
		IssuedAt: now.Add(-time.Minute).Format(time.RFC3339Nano), ExpiresAt: now.Add(time.Minute).Format(time.RFC3339Nano),
		Release: agentUpgradeRelease{
			ReleaseID: "release-dev", ProductLine: agentUpgradeProductLine, Version: "0.2.0", Platform: "linux",
			Architecture: currentLinuxArchitecture(), DownloadURL: "http://127.0.0.1:3003/agent-releases/release-dev",
			ArtifactSHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", ArtifactSize: 100,
		},
		UpgradeBootstrapURL: "http://127.0.0.1:3003/agent-install?token=bootstrap-dev",
	}
	if err := validateUpgradeEnvelope(&AgentConfig{}, "agent-dev", envelope); err != nil {
		t.Fatalf("开发环境无签名 HTTP Release 不应被拒绝: %v", err)
	}
}

func TestLinuxUpgradeArtifactSignatureUsesRawArtifact(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	path := t.TempDir() + "/agent"
	artifact := []byte("linux-agent-release")
	if err := os.WriteFile(path, artifact, 0o600); err != nil {
		t.Fatal(err)
	}
	keySet := map[string]string{"release": base64.RawURLEncoding.EncodeToString(publicKey)}
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, artifact))
	if err := verifyUpgradeArtifactSignature(path, "release", signature, keySet); err != nil {
		t.Fatalf("原始制品签名回放失败: %v", err)
	}
	bad := base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, []byte("artifact-digest")))
	if err := verifyUpgradeArtifactSignature(path, "release", bad, keySet); err == nil {
		t.Fatal("只签名摘要文本时必须被拒绝")
	}
}

func TestReconcileCompletedLinuxUpgradeStatus(t *testing.T) {
	config := &AgentConfig{}
	config.Paths.Linux.DataDir = t.TempDir()
	status := agentUpgradeStatus{
		SchemaVersion: agentUpgradeSchemaVersion,
		PlanID:        "plan-stale",
		TransactionID: "transaction-stale",
		AgentID:       "agent-stale",
		FromVersion:   "0.1.17",
		TargetVersion: agentVersion,
		Phase:         "helper_started",
		Status:        "running",
		UpdatedAt:     time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano),
	}
	reconciled := reconcileCompletedUpgradeStatus(config, status)
	if reconciled.Status != "succeeded" || reconciled.Phase != "verified" {
		t.Fatalf("已运行目标版本的旧事务应补记成功: %+v", reconciled)
	}
	if loaded := loadUpgradeStatus(config); loaded.Status != "succeeded" {
		t.Fatalf("补记结果未持久化: %+v", loaded)
	}
}

func TestReconcileStaleLinuxUpgradeHelperRequiresManualAction(t *testing.T) {
	config := &AgentConfig{}
	config.Paths.Linux.DataDir = t.TempDir()
	status := agentUpgradeStatus{
		SchemaVersion: agentUpgradeSchemaVersion,
		PlanID:        "plan-timeout",
		TransactionID: "transaction-timeout",
		AgentID:       "agent-timeout",
		FromVersion:   "0.1.20",
		TargetVersion: "9.9.9",
		Phase:         "helper_started",
		Status:        "running",
		UpdatedAt:     time.Now().Add(-(agentUpgradeHelperTimeout + time.Second)).UTC().Format(time.RFC3339Nano),
	}
	reconciled := reconcileCompletedUpgradeStatus(config, status)
	if reconciled.Status != "manual_required" || reconciled.Phase != "manual_required" {
		t.Fatalf("过期 helper 且版本未达目标时必须进入人工处置: %+v", reconciled)
	}
	if reconciled.ErrorCode != "AGENT_UPGRADE_HELPER_TIMEOUT" || reconciled.Rollback != "unknown" {
		t.Fatalf("过期 helper 缺少明确错误证据: %+v", reconciled)
	}
	if loaded := loadUpgradeStatus(config); loaded.Status != "manual_required" {
		t.Fatalf("人工处置结果未持久化: %+v", loaded)
	}
}

func TestAgentVersionAtLeastAllowsStaleOlderTarget(t *testing.T) {
	if !agentVersionAtLeast("0.1.18", "0.1.17") {
		t.Fatal("当前版本高于残留事务目标版本时应允许收敛")
	}
	if !agentVersionAtLeast("0.1.18", "0.1.18") {
		t.Fatal("当前版本等于残留事务目标版本时应允许收敛")
	}
	if agentVersionAtLeast("0.1.17", "0.1.18") {
		t.Fatal("当前版本低于目标版本时不得误判为已完成")
	}
}
