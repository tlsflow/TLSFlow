package main

import "testing"

func TestActionRegistryResolvesCanonicalAliasAndLegacySelector(t *testing.T) {
	registry := mustBuildWindowsActionHandlerRegistry()
	cases := []struct {
		name    string
		payload map[string]any
	}{
		{name: "canonical", payload: map[string]any{"type": "certificate.deploy"}},
		{name: "published alias", payload: map[string]any{"type": "windows.iis.deploy_certificate"}},
		{name: "legacy provider", payload: map[string]any{"providerType": "IIS"}},
		{name: "legacy action", payload: map[string]any{"action": "INSTALL_CERTIFICATE"}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			resolved, err := registry.Resolve(testCase.payload)
			if err != nil {
				t.Fatalf("resolve failed: %v", err)
			}
			if resolved.ActionType != "certificate.deploy" {
				t.Fatalf("unexpected action type: %s", resolved.ActionType)
			}
		})
	}
}

func TestActionRegistryRejectsUnknownSchema(t *testing.T) {
	registry := mustBuildWindowsActionHandlerRegistry()
	_, err := registry.Resolve(map[string]any{"type": "windows.iis.deploy_certificate", "actionSchemaVersion": "2.0"})
	registryError, ok := err.(*actionRegistryError)
	if !ok || registryError.Code != "ACTION_SCHEMA_UNSUPPORTED" {
		t.Fatalf("expected ACTION_SCHEMA_UNSUPPORTED, got %#v", err)
	}
}

func TestActionRegistryRejectsDuplicateAlias(t *testing.T) {
	stub := func(actionType string) actionHandler {
		return actionHandlerFunc{descriptor: actionHandlerDescriptor{ActionType: actionType, SchemaVersions: []string{"1.0"}, Aliases: []string{"legacy.action"}}}
	}
	_, err := newActionHandlerRegistry(stub("action.one"), stub("action.two"))
	registryError, ok := err.(*actionRegistryError)
	if !ok || registryError.Code != "ACTION_ALIAS_CONFLICT" {
		t.Fatalf("expected ACTION_ALIAS_CONFLICT, got %#v", err)
	}
}
