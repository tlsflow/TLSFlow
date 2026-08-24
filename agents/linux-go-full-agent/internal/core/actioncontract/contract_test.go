package actioncontract

import (
	"testing"

	"gcac/linux-go-full-agent/internal/compatibility"
)

func TestParseCanonicalActionContract(t *testing.T) {
	request, err := Parse(map[string]any{
		"schemaVersion":       compatibility.ActionContractVersion,
		"actionType":          compatibility.CanonicalDeployAction,
		"actionSchemaVersion": compatibility.ActionSchemaVersion,
		"requestId":           "request-1",
		"idempotencyKey":      "deploy-1",
		"input":               map[string]any{"productAdapterId": compatibility.ProductApache, "artifactFormat": "pem"},
	})
	if err != nil || request.ProductAdapterID != compatibility.ProductApache {
		t.Fatalf("规范动作解析失败: request=%#v err=%v", request, err)
	}
}

func TestParseLegacyAlias(t *testing.T) {
	request, err := Parse(map[string]any{"type": "linux.nginx.deploy_certificate"})
	if err != nil || request.ActionType != compatibility.CanonicalDeployAction || request.ProductAdapterID != compatibility.ProductNginx {
		t.Fatalf("旧动作 Alias 解析失败: request=%#v err=%v", request, err)
	}
}
