package actioncontract

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"gcac/linux-go-full-agent/internal/compatibility"
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
	LegacyActionType string
	ProductAdapterID string
	ArtifactFormat   string
}

func Parse(payload map[string]any) (Normalized, error) {
	if strings.TrimSpace(stringValue(payload["schemaVersion"])) == "" {
		return parseLegacy(payload)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return Normalized{}, err
	}
	var request Request
	if err := json.Unmarshal(raw, &request); err != nil {
		return Normalized{}, err
	}
	if request.SchemaVersion != compatibility.ActionContractVersion {
		return Normalized{}, errors.New("ACTION_SCHEMA_UNSUPPORTED")
	}
	if request.ActionType != compatibility.CanonicalDeployAction || request.ActionSchemaVersion != compatibility.ActionSchemaVersion {
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

func parseLegacy(payload map[string]any) (Normalized, error) {
	legacyActionType := strings.TrimSpace(stringValue(payload["type"]))
	if legacyActionType == "" {
		return Normalized{}, errors.New("ACTION_TYPE_REQUIRED")
	}
	productAdapterID := ""
	switch strings.ToLower(legacyActionType) {
	case "linux.nginx.deploy_certificate":
		productAdapterID = compatibility.ProductNginx
	case "linux.apache.deploy_certificate":
		productAdapterID = compatibility.ProductApache
	case "linux.tomcat.deploy_certificate":
		productAdapterID = compatibility.ProductTomcat
	default:
		return Normalized{}, fmt.Errorf("ACTION_HANDLER_NOT_REGISTERED: %s", legacyActionType)
	}
	return Normalized{
		Request: Request{
			SchemaVersion:       compatibility.ActionContractVersion,
			ActionType:          compatibility.CanonicalDeployAction,
			ActionSchemaVersion: compatibility.ActionSchemaVersion,
			RequestID:           firstString(payload, "requestId", "taskId"),
			IdempotencyKey:      firstString(payload, "idempotencyKey", "taskId"),
			Input:               payload,
			DryRun:              boolValue(payload["dryRun"]),
			Audit:               map[string]any{},
		},
		LegacyActionType: legacyActionType,
		ProductAdapterID: productAdapterID,
		ArtifactFormat:   artifactFormat(payload),
	}, nil
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

func boolValue(value any) bool {
	result, _ := value.(bool)
	return result
}
