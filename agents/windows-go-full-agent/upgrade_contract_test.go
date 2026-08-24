package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"testing"
	"time"
)

func TestValidateUpgradeEnvelopeRejectsInvalidURLAndCurrentVersion(t *testing.T) {
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
		IssuedAt:       now.Add(-time.Minute).Format(time.RFC3339Nano),
		ExpiresAt:      now.Add(time.Minute).Format(time.RFC3339Nano),
		AuthorityKeyID: "control",
		Release: agentUpgradeRelease{
			ReleaseID: "release-1", ProductLine: agentUpgradeProductLine, Version: "0.2.0",
			Platform: "windows", Architecture: "amd64", DownloadURL: "ftp://invalid.example/agent.exe",
			ArtifactSHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			ArtifactSize:   100, SignatureKeyID: "release", ArtifactSignature: "placeholder",
		},
	}
	envelope.ControlPlaneSignature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, upgradeEnvelopeWithoutSignature(envelope)))
	if err := validateUpgradeEnvelope(config, "agent-1", envelope); err == nil {
		t.Fatal("非 HTTP(S) 下载地址必须被拒绝")
	}
	envelope.Release.DownloadURL = "https://release.example/agent.exe"
	envelope.Release.Version = agentVersion
	envelope.ControlPlaneSignature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, upgradeEnvelopeWithoutSignature(envelope)))
	if err := validateUpgradeEnvelope(config, "agent-1", envelope); err == nil {
		t.Fatal("当前版本目标必须被拒绝")
	}
	envelope.Release.Version = "0.2.1"
	envelope.Release.Architecture = ""
	envelope.ControlPlaneSignature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, upgradeEnvelopeWithoutSignature(envelope)))
	if err := validateUpgradeEnvelope(config, "agent-1", envelope); err == nil {
		t.Fatal("缺少目标架构必须被拒绝")
	}
}

func TestUpgradeEnvelopeSignatureRoundTrip(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	value := []byte("artifact-digest")
	signature := base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, value))
	if err := verifyUpgradeSignature("release", signature, value, map[string]string{"release": base64.StdEncoding.EncodeToString(publicKey)}); err != nil {
		t.Fatalf("签名回放失败: %v", err)
	}
	if err := verifyUpgradeSignature("release", signature, []byte("other-digest"), map[string]string{"release": base64.StdEncoding.EncodeToString(publicKey)}); err == nil {
		t.Fatal("签名内容被篡改时必须失败")
	}
}

func TestUpgradeEnvelopeBootstrapURLIsSigned(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	envelope := agentUpgradeEnvelope{
		SchemaVersion: agentUpgradeSchemaVersion, PlanID: "plan-bootstrap", TransactionID: "txn-bootstrap", AgentID: "agent-bootstrap",
		UpgradeBootstrapURL: "https://control.example/agent-install.ps1?token=one-time",
		Nonce:               "nonce-bootstrap", IssuedAt: now.Add(-time.Minute).Format(time.RFC3339Nano), ExpiresAt: now.Add(time.Minute).Format(time.RFC3339Nano),
		Release: agentUpgradeRelease{ReleaseID: "release-bootstrap", ProductLine: agentUpgradeProductLine, Version: "0.2.0", Platform: "windows", Architecture: "amd64", DownloadURL: "https://release.example/agent.exe", ArtifactSHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", ArtifactSize: 100},
	}
	signature := base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, upgradeEnvelopeWithoutSignature(envelope)))
	if err := verifyUpgradeSignature("control", signature, upgradeEnvelopeWithoutSignature(envelope), map[string]string{"control": base64.RawURLEncoding.EncodeToString(publicKey)}); err != nil {
		t.Fatalf("bootstrap URL 签名回放失败: %v", err)
	}
	envelope.UpgradeBootstrapURL = "https://control.example/agent-install.ps1?token=tampered"
	if err := verifyUpgradeSignature("control", signature, upgradeEnvelopeWithoutSignature(envelope), map[string]string{"control": base64.RawURLEncoding.EncodeToString(publicKey)}); err == nil {
		t.Fatal("bootstrap URL 被篡改时必须拒绝")
	}
}

func TestValidateUpgradeEnvelopeAllowsUnsignedHTTPForDevelopment(t *testing.T) {
	now := time.Now().UTC()
	envelope := agentUpgradeEnvelope{
		SchemaVersion: agentUpgradeSchemaVersion,
		PlanID:        "plan-dev", TransactionID: "transaction-dev", AgentID: "agent-dev", Nonce: "nonce-dev",
		IssuedAt:  now.Add(-time.Minute).Format(time.RFC3339Nano),
		ExpiresAt: now.Add(time.Minute).Format(time.RFC3339Nano),
		Release: agentUpgradeRelease{
			ReleaseID: "release-dev", ProductLine: agentUpgradeProductLine, Version: "0.2.0",
			Platform: "windows", Architecture: "amd64", DownloadURL: "http://127.0.0.1:3003/agent-releases/release-dev",
			ArtifactSHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			ArtifactSize:   100,
		},
	}
	if err := validateUpgradeEnvelope(&AgentConfig{}, "agent-dev", envelope); err != nil {
		t.Fatalf("开发环境无签名 HTTP Release 不应被拒绝: %v", err)
	}
}

func TestUpgradeArtifactSignatureUsesRawArtifact(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	artifact := []byte("windows-agent-release")
	path := t.TempDir() + "/agent.exe"
	if err := os.WriteFile(path, artifact, 0o600); err != nil {
		t.Fatal(err)
	}
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, artifact))
	keySet := map[string]string{"release": base64.RawURLEncoding.EncodeToString(publicKey)}
	if err := verifyUpgradeArtifactSignature(path, "release", signature, keySet); err != nil {
		t.Fatalf("原始制品签名回放失败: %v", err)
	}
	if err := verifyUpgradeArtifactSignature(path, "release", base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, []byte("artifact-digest"))), keySet); err == nil {
		t.Fatal("只签名摘要文本时必须被拒绝")
	}
}
