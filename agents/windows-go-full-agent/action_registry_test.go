package main

import "testing"

func TestActionRegistryRejectsHistoricalProductActions(t *testing.T) {
	registry := mustBuildWindowsActionHandlerRegistry()
	cases := []struct {
		name    string
		payload map[string]any
	}{
		{name: "legacy canonical", payload: map[string]any{"type": "certificate.deploy"}},
		{name: "published alias", payload: map[string]any{"type": "windows.iis.deploy_certificate"}},
		{name: "legacy action", payload: map[string]any{"action": "INSTALL_CERTIFICATE"}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := registry.Resolve(testCase.payload)
			registryError, ok := err.(*actionRegistryError)
			if !ok || registryError.Code != "ACTION_HANDLER_NOT_REGISTERED" {
				t.Fatalf("expected ACTION_HANDLER_NOT_REGISTERED, got %#v", err)
			}
		})
	}
}

func TestActionRegistryRejectsUnknownSchema(t *testing.T) {
	registry := mustBuildWindowsActionHandlerRegistry()
	_, err := registry.Resolve(map[string]any{"type": "agent.atomic_plan.execute", "actionSchemaVersion": "2.0"})
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
