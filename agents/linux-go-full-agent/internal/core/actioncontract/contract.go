package actioncontract

import (
	"encoding/json"
	"errors"
	"strings"
)

const (
	ContractVersion = "gcac.action/v1"
	DeployAction    = "certificate.deploy"
	DeployVersion   = "1.0"
)

type Request struct {
	SchemaVersion       string         `json:"schemaVersion"`
	ActionType          string         `json:"actionType"`
	ActionSchemaVersion string         `json:"actionSchemaVersion"`
	RequestID           string         `json:"requestId"`
	IdempotencyKey      string         `json:"idempotencyKey"`
	Input               map[string]any `json:"input"`
	DryRun              bool           `json:"dryRun"`
	Audit               map[string]any `json:"audit"`
	Recovery            map[string]any `json:"recovery,omitempty"`
}

type Normalized struct {
	Request
	ProductAdapterID string
	ArtifactFormat   string
}

func Parse(payload map[string]any) (Normalized, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return Normalized{}, err
	}
	var request Request
	if err := json.Unmarshal(raw, &request); err != nil {
		return Normalized{}, err
	}
	if request.SchemaVersion != ContractVersion {
		return Normalized{}, errors.New("ACTION_SCHEMA_UNSUPPORTED")
	}
	if request.ActionType != DeployAction || request.ActionSchemaVersion != DeployVersion {
		return Normalized{}, errors.New("ACTION_SCHEMA_UNSUPPORTED")
	}
	if strings.TrimSpace(request.RequestID) == "" || strings.TrimSpace(request.IdempotencyKey) == "" {
		return Normalized{}, errors.New("ACTION_REQUEST_INVALID")
	}
	productAdapterID := stringValue(request.Input["productAdapterId"])
	if productAdapterID == "" {
		return Normalized{}, errors.New("PRODUCT_ADAPTER_REQUIRED")
	}
	return Normalized{Request: request, ProductAdapterID: productAdapterID, ArtifactFormat: artifactFormat(request.Input)}, nil
}

func artifactFormat(input map[string]any) string {
	if value := stringValue(input["artifactFormat"]); value != "" {
		return value
	}
	artifact, _ := input["artifact"].(map[string]any)
	return firstString(artifact, "format", "type")
}

func stringValue(value any) string {
	result, _ := value.(string)
	return strings.TrimSpace(result)
}

func firstString(value map[string]any, keys ...string) string {
	for _, key := range keys {
		if result := stringValue(value[key]); result != "" {
			return result
		}
	}
	return ""
}
