package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"
	"time"
)

func TestPersistedTrustMaterialUsesInstallPinnedKeySet(t *testing.T) {
	defer setAgentTrustMaterial(nil)
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	config := &AgentConfig{AuthorizationMaterialPath: t.TempDir() + "/policy/trust.json"}
	config.AuthorizationTrustKeySet = map[string]string{
		"authority-key-1": base64.StdEncoding.EncodeToString(publicKey),
	}
	policy := agentLocalPolicyWire{
		PolicyVersion:   agentSecurityContract,
		AgentID:         "agt-happy",
		AuthorityKeyIDs: []string{"authority-key-1"},
		AllowedActions:  []string{"filesystem.read", "process.list", "service.list"},
		ServiceRules:    []string{},
		CommandRules:    []any{},
		UpdatedAt:       time.Now().UTC().Format(time.RFC3339Nano),
	}
	policy.PathRules = append(policy.PathRules, struct {
		Prefix     string   `json:"prefix"`
		Operations []string `json:"operations"`
	}{Prefix: `C:\\inetpub`, Operations: []string{"filesystem.read"}})
	material := &agentTrustMaterialWire{
		MaterialVersion:           "gcac.agent-trust-material/v1",
		IssuedAt:                  time.Now().UTC().Format(time.RFC3339Nano),
		ValidUntil:                time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano),
		CapabilityKeySet:          config.AuthorizationTrustKeySet,
		PolicyAuthorityKeySet:     config.AuthorizationTrustKeySet,
		LocalPolicy:               policy,
		LocalPolicyAuthorityKeyID: "authority-key-1",
	}
	material.LocalPolicySignature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, canonicalJSON(localPolicyWithoutSignature(policy))))

	if err := persistAgentTrustMaterial(config, "agt-happy", material); err != nil {
		t.Fatalf("应接受安装时固定公钥签名的授权材料: %v", err)
	}
	if currentAgentTrustMaterial() == nil {
		t.Fatal("持久化后必须加载授权材料")
	}

	tampered := *material
	tampered.LocalPolicy = material.LocalPolicy
	tampered.LocalPolicy.AgentID = "agt-tampered"
	if err := validateAgentTrustMaterial(config, "agt-tampered", &tampered); err == nil {
		t.Fatal("篡改后的本地策略必须被签名校验拒绝")
	}
}

func TestPersistedTrustMaterialSuppliesBase64URLKeySetAndLocalPolicy(t *testing.T) {
	defer setAgentTrustMaterial(nil)
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	config := &AgentConfig{AuthorizationMaterialPath: t.TempDir() + "/policy/trust.json"}
	config.AuthorizationTrustKeySet = map[string]string{
		"authority-key-1": base64.StdEncoding.EncodeToString(publicKey),
	}
	policy := agentLocalPolicyWire{
		PolicyVersion:   agentSecurityContract,
		AgentID:         "agt-happy",
		AuthorityKeyIDs: []string{"authority-key-1"},
		AllowedActions:  []string{"filesystem.read"},
		ServiceRules:    []string{},
		CommandRules:    []any{},
		UpdatedAt:       time.Now().UTC().Format(time.RFC3339Nano),
	}
	policy.PathRules = append(policy.PathRules, struct {
		Prefix     string   `json:"prefix"`
		Operations []string `json:"operations"`
	}{Prefix: `C:\\inetpub`, Operations: []string{"filesystem.read"}})
	material := &agentTrustMaterialWire{
		MaterialVersion:           "gcac.agent-trust-material/v1",
		IssuedAt:                  time.Now().UTC().Format(time.RFC3339Nano),
		ValidUntil:                time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano),
		CapabilityKeySet:          config.AuthorizationTrustKeySet,
		PolicyAuthorityKeySet:     config.AuthorizationTrustKeySet,
		LocalPolicy:               policy,
		LocalPolicyAuthorityKeyID: "authority-key-1",
	}
	material.LocalPolicySignature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, canonicalJSON(localPolicyWithoutSignature(policy))))
	if err := persistAgentTrustMaterial(config, "agt-happy", material); err != nil {
		t.Fatal(err)
	}

	t.Setenv("GCAC_AGENT_CAPABILITY_KEYSET_JSON", "")
	t.Setenv("GCAC_POLICY_AUTHORITY_KEYSET_JSON", "")
	t.Setenv("GCAC_AGENT_LOCAL_POLICY_JSON", "")
	payload := map[string]any{"agentId": "agt-happy", "action": agentFactCollect}
	signature := base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, canonicalJSON(payload)))
	if err := verifySignedValue("authority-key-1", signature, payload, "GCAC_AGENT_CAPABILITY_KEYSET_JSON"); err != nil {
		t.Fatalf("持久化 KeySet 必须验证 Base64URL 签名: %v", err)
	}
	if err := validateLocalPolicy([]string{`C:\\inetpub\\wwwroot\\site.config`}, nil); err != nil {
		t.Fatalf("持久化本地策略必须限制并允许受控路径: %v", err)
	}
}
