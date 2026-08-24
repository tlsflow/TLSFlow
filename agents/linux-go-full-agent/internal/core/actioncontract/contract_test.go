package actioncontract

import "testing"

func TestParseCanonicalActionContract(t *testing.T) {
	request, err := Parse(map[string]any{
		"schemaVersion":       ContractVersion,
		"actionType":          DeployAction,
		"actionSchemaVersion": DeployVersion,
		"requestId":           "request-1",
		"idempotencyKey":      "deploy-1",
		"input":               map[string]any{"productAdapterId": "product.example", "artifactFormat": "pem"},
	})
	if err != nil || request.ProductAdapterID != "product.example" {
		t.Fatalf("规范动作解析失败: request=%#v err=%v", request, err)
	}
}

func TestParseRejectsMissingContractVersion(t *testing.T) {
	if _, err := Parse(map[string]any{"actionType": DeployAction}); err == nil {
		t.Fatal("缺少合同版本时必须失败关闭")
	}
}
