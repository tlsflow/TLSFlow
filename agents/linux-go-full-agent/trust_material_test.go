package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"
	"time"
)

func TestLocalPolicyCanonicalJSONMatchesControlPlaneOrdering(t *testing.T) {
	policy := agentLocalPolicyWire{
		PolicyVersion:   agentSecurityContract,
		AgentID:         "agt-happy",
		AuthorityKeyIDs: []string{"local-signing-1"},
		AllowedActions:  []string{"filesystem.read"},
		ServiceRules:    []string{},
		CommandRules:    []any{},
		UpdatedAt:       "2026-08-13T00:00:00.000Z",
	}
	policy.PathRules = append(policy.PathRules, struct {
		Prefix     string   `json:"prefix"`
		Operations []string `json:"operations"`
	}{Prefix: "/etc", Operations: []string{"filesystem.read"}})

	expected := `{"agentId":"agt-happy","allowedActions":["filesystem.read"],"authorityKeyIds":["local-signing-1"],"commandRules":[],"disabled":false,"pathRules":[{"operations":["filesystem.read"],"prefix":"/etc"}],"policyVersion":"` + agentSecurityContract + `","serviceRules":[],"updatedAt":"2026-08-13T00:00:00.000Z"}`
	if actual := string(canonicalJSON(localPolicyWithoutSignature(policy))); actual != expected {
		t.Fatalf("本地策略规范化 JSON 必须与控制面一致:\nactual:   %s\nexpected: %s", actual, expected)
	}
}

func TestPersistedTrustMaterialUsesInstallPinnedKeySet(t *testing.T) {
	defer setAgentTrustMaterial(nil)
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	config := &AgentConfig{AuthorizationMaterialPath: t.TempDir() + "/policy/trust.json"}
	config.AuthorizationTrustKeySet = map[string]string{
		"local-signing-1": base64.StdEncoding.EncodeToString(publicKey),
	}
	policy := agentLocalPolicyWire{
		PolicyVersion:   agentSecurityContract,
		AgentID:         "agt-happy",
		AuthorityKeyIDs: []string{"local-signing-1"},
		AllowedActions:  []string{"filesystem.read", "process.list", "service.list"},
		ServiceRules:    []string{},
		CommandRules:    []any{},
		Disabled:        false,
		UpdatedAt:       time.Now().UTC().Format(time.RFC3339Nano),
	}
	policy.PathRules = append(policy.PathRules, struct {
		Prefix     string   `json:"prefix"`
		Operations []string `json:"operations"`
	}{Prefix: "/etc", Operations: []string{"filesystem.read"}})
	material := &agentTrustMaterialWire{
		MaterialVersion:           "gcac.agent-trust-material/v1",
		IssuedAt:                  time.Now().UTC().Format(time.RFC3339Nano),
		ValidUntil:                time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano),
		CapabilityKeySet:          config.AuthorizationTrustKeySet,
		PolicyAuthorityKeySet:     config.AuthorizationTrustKeySet,
		LocalPolicy:               policy,
		LocalPolicyAuthorityKeyID: "local-signing-1",
	}
	material.LocalPolicySignature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, canonicalJSON(localPolicyWithoutSignature(policy))))
	if err := persistAgentTrustMaterial(config, "agt-happy", material); err != nil {
		t.Fatalf("应接受安装时固定公钥签名的授权材料: %v", err)
	}

	tampered := *material
	tampered.LocalPolicy = material.LocalPolicy
	tampered.LocalPolicy.AgentID = "agt-other"
	if err := validateAgentTrustMaterial(config, "agt-other", &tampered); err == nil {
		t.Fatal("篡改后的本地策略必须被签名校验拒绝")
	}
}
