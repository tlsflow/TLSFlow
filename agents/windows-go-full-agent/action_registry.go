package main

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type actionExecutionResult struct {
	Success      bool
	ErrorCode    string
	ErrorMessage string
	Detail       map[string]any
}

type actionAliasSelector struct {
	Fields map[string]string
}

type actionHandlerDescriptor struct {
	ActionType      string
	SchemaVersions  []string
	Aliases         []string
	LegacySelectors []actionAliasSelector
	DirectControl   bool
}

type actionHandler interface {
	Descriptor() actionHandlerDescriptor
	Execute(*taskExecutionContext) actionExecutionResult
}

type actionHandlerFunc struct {
	descriptor actionHandlerDescriptor
	execute    func(*taskExecutionContext) actionExecutionResult
}

func (h actionHandlerFunc) Descriptor() actionHandlerDescriptor {
	return h.descriptor
}

func (h actionHandlerFunc) Execute(execution *taskExecutionContext) actionExecutionResult {
	return h.execute(execution)
}

type resolvedActionHandler struct {
	Handler         actionHandler
	RequestedType   string
	ActionType      string
	SchemaVersion   string
	ResolvedByAlias bool
}

type actionRegistryError struct {
	Code    string
	Message string
}

func (e *actionRegistryError) Error() string {
	return e.Message
}

type actionHandlerRegistry struct {
	handlers      map[string]actionHandler
	actionIndex   map[string]string
	selectorIndex map[string]string
	selectors     []registeredActionSelector
}

type registeredActionSelector struct {
	key        string
	actionType string
	selector   actionAliasSelector
}

var windowsActionHandlers = mustBuildWindowsActionHandlerRegistry()

func newActionHandlerRegistry(handlers ...actionHandler) (*actionHandlerRegistry, error) {
	registry := &actionHandlerRegistry{
		handlers:      map[string]actionHandler{},
		actionIndex:   map[string]string{},
		selectorIndex: map[string]string{},
		selectors:     []registeredActionSelector{},
	}
	for _, handler := range handlers {
		if err := registry.register(handler); err != nil {
			return nil, err
		}
	}
	return registry, nil
}

func mustBuildWindowsActionHandlerRegistry() *actionHandlerRegistry {
	registry, err := newActionHandlerRegistry(
		windowsIISActionHandler(),
		selfTestActionHandler(),
		capabilityRescanActionHandler(),
		gatewayActionHandler(),
		windowsAtomicPlanActionHandler(),
	)
	if err != nil {
		panic(err)
	}
	return registry
}

func (r *actionHandlerRegistry) register(handler actionHandler) error {
	if handler == nil {
		return &actionRegistryError{Code: "ACTION_HANDLER_INVALID", Message: "action handler is nil"}
	}
	descriptor := handler.Descriptor()
	actionType := normalizeActionName(descriptor.ActionType)
	if actionType == "" || len(descriptor.SchemaVersions) == 0 {
		return &actionRegistryError{Code: "ACTION_HANDLER_INVALID", Message: "action handler descriptor is incomplete"}
	}
	if _, exists := r.handlers[actionType]; exists {
		return &actionRegistryError{Code: "ACTION_HANDLER_REGISTRATION_CONFLICT", Message: fmt.Sprintf("duplicate action handler: %s", actionType)}
	}
	r.handlers[actionType] = handler
	for _, name := range append([]string{actionType}, descriptor.Aliases...) {
		key := normalizeActionName(name)
		if existing, exists := r.actionIndex[key]; exists {
			return &actionRegistryError{Code: "ACTION_ALIAS_CONFLICT", Message: fmt.Sprintf("action alias %s conflicts with %s", key, existing)}
		}
		r.actionIndex[key] = actionType
	}
	for _, selector := range descriptor.LegacySelectors {
		key := selectorKey(selector)
		if key == "" {
			return &actionRegistryError{Code: "ACTION_ALIAS_INVALID", Message: fmt.Sprintf("empty legacy selector for %s", actionType)}
		}
		if existing, exists := r.selectorIndex[key]; exists {
			return &actionRegistryError{Code: "ACTION_ALIAS_CONFLICT", Message: fmt.Sprintf("legacy selector conflicts between %s and %s", existing, actionType)}
		}
		r.selectorIndex[key] = actionType
		r.selectors = append(r.selectors, registeredActionSelector{key: key, actionType: actionType, selector: selector})
	}
	sort.Slice(r.selectors, func(left, right int) bool { return r.selectors[left].key < r.selectors[right].key })
	return nil
}

func (r *actionHandlerRegistry) Resolve(payload map[string]any) (*resolvedActionHandler, error) {
	requestedType := firstNonEmpty(stringFromMap(payload, "actionType"), stringFromMap(payload, "type"))
	actionType := ""
	resolvedByAlias := false
	if requestedType != "" {
		actionType = r.actionIndex[normalizeActionName(requestedType)]
		if actionType == "" {
			return nil, &actionRegistryError{Code: "ACTION_HANDLER_NOT_REGISTERED", Message: fmt.Sprintf("action handler not registered: %s", requestedType)}
		}
		resolvedByAlias = normalizeActionName(requestedType) != actionType
	} else {
		matches := r.matchLegacySelectors(payload)
		if len(matches) == 0 {
			return nil, &actionRegistryError{Code: "ACTION_HANDLER_NOT_REGISTERED", Message: "action type is missing and no legacy alias matched"}
		}
		if len(matches) > 1 {
			return nil, &actionRegistryError{Code: "ACTION_HANDLER_AMBIGUOUS", Message: fmt.Sprintf("multiple legacy action aliases matched: %s", strings.Join(matches, ", "))}
		}
		actionType = matches[0]
		requestedType = actionType
		resolvedByAlias = true
	}
	handler := r.handlers[actionType]
	schemaVersion := firstNonEmpty(stringFromMap(payload, "actionSchemaVersion"), "1.0")
	if !containsString(handler.Descriptor().SchemaVersions, schemaVersion) {
		return nil, &actionRegistryError{Code: "ACTION_SCHEMA_UNSUPPORTED", Message: fmt.Sprintf("unsupported action schema %s for %s", schemaVersion, requestedType)}
	}
	return &resolvedActionHandler{
		Handler:         handler,
		RequestedType:   requestedType,
		ActionType:      actionType,
		SchemaVersion:   schemaVersion,
		ResolvedByAlias: resolvedByAlias,
	}, nil
}

func (r *actionHandlerRegistry) Execute(execution *taskExecutionContext) actionExecutionResult {
	payload := execution.task.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	resolved, err := r.Resolve(payload)
	if err != nil {
		registryError, ok := err.(*actionRegistryError)
		if !ok {
			return actionExecutionResult{Success: false, ErrorCode: "ACTION_HANDLER_NOT_REGISTERED", ErrorMessage: err.Error()}
		}
		return actionExecutionResult{
			Success:      false,
			ErrorCode:    registryError.Code,
			ErrorMessage: registryError.Message,
			Detail: map[string]any{
				"supportedActions": r.PublishedActionTypes(false),
				"taskId":           execution.task.ID,
				"executionStepId":  execution.task.ExecutionStepID,
			},
		}
	}
	result := resolved.Handler.Execute(execution)
	if result.Detail == nil {
		result.Detail = map[string]any{}
	}
	result.Detail["actionType"] = resolved.ActionType
	result.Detail["requestedActionType"] = resolved.RequestedType
	result.Detail["actionSchemaVersion"] = resolved.SchemaVersion
	result.Detail["resolvedByAlias"] = resolved.ResolvedByAlias
	return result
}

func (r *actionHandlerRegistry) PublishedActionTypes(directControlOnly bool) []string {
	values := []string{}
	for actionType, handler := range r.handlers {
		descriptor := handler.Descriptor()
		if directControlOnly && !descriptor.DirectControl {
			continue
		}
		values = append(values, actionType)
		values = append(values, descriptor.Aliases...)
	}
	values = uniqueSortedStrings(values)
	return values
}

func (r *actionHandlerRegistry) matchLegacySelectors(payload map[string]any) []string {
	matches := []string{}
	for _, entry := range r.selectors {
		matched := true
		for field, expected := range entry.selector.Fields {
			if !strings.EqualFold(strings.TrimSpace(stringFromMap(payload, field)), strings.TrimSpace(expected)) {
				matched = false
				break
			}
		}
		if matched {
			matches = append(matches, entry.actionType)
		}
	}
	return uniqueSortedStrings(matches)
}

func windowsIISActionHandler() actionHandler {
	return actionHandlerFunc{
		descriptor: actionHandlerDescriptor{
			ActionType:      "certificate.deploy",
			SchemaVersions:  []string{"1.0"},
			Aliases:         []string{"windows.iis.deploy_certificate"},
			LegacySelectors: []actionAliasSelector{{Fields: map[string]string{"providerType": "IIS"}}, {Fields: map[string]string{"action": "INSTALL_CERTIFICATE"}}},
			DirectControl:   true,
		},
		execute: func(execution *taskExecutionContext) actionExecutionResult {
			success, code, message, detail := runWindowsIISDeployment(execution)
			return actionExecutionResult{Success: success, ErrorCode: code, ErrorMessage: message, Detail: detail}
		},
	}
}

func selfTestActionHandler() actionHandler {
	return actionHandlerFunc{
		descriptor: actionHandlerDescriptor{ActionType: "agent.self_test", SchemaVersions: []string{"1.0"}},
		execute: func(execution *taskExecutionContext) actionExecutionResult {
			execution.submitLog("info", "任务以 self-test 模式结束")
			return actionExecutionResult{Success: true, Detail: map[string]any{"executor": "windows-go-agent-runtime", "mode": "self-test", "taskId": execution.task.ID}}
		},
	}
}

func capabilityRescanActionHandler() actionHandler {
	return actionHandlerFunc{
		descriptor: actionHandlerDescriptor{ActionType: "capability.rescan", SchemaVersions: []string{"1.0"}, Aliases: []string{"agent.capability.rescan"}},
		execute: func(execution *taskExecutionContext) actionExecutionResult {
			payload := execution.task.Payload
			execution.submitLog("info", "开始执行手动能力重扫")
			if err := reportCapabilities(execution.ctx, execution.client, execution.config, execution.registration, collectRuntimeIdentity(execution.config.ControlPlane)); err != nil {
				_ = submitRuntimeLog(execution.ctx, execution.client, execution.config, submitRuntimeLogRequest{
					AgentID: execution.registration.AgentID, Category: "manual_rescan", Level: "error", Summary: "manual capability rescan failed",
					Detail: map[string]any{"error": err.Error(), "taskId": execution.task.ID, "requestedBy": stringFromMap(payload, "requestedBy")}, EmittedAt: nowRFC3339(),
				})
				execution.submitLog("error", "能力重扫失败: %v", err)
				return actionExecutionResult{Success: false, ErrorCode: "RESCAN_REPORT_FAILED", ErrorMessage: err.Error(), Detail: map[string]any{
					"executor": "windows-go-agent-runtime", "mode": "capability-rescan", "executionStepId": execution.task.ExecutionStepID,
					"taskId": execution.task.ID, "requestedBy": stringFromMap(payload, "requestedBy"),
				}}
			}
			_ = submitRuntimeLog(execution.ctx, execution.client, execution.config, submitRuntimeLogRequest{
				AgentID: execution.registration.AgentID, Category: "manual_rescan", Level: "info", Summary: "manual capability rescan succeeded",
				Detail: map[string]any{"taskId": execution.task.ID, "requestedBy": stringFromMap(payload, "requestedBy")}, EmittedAt: nowRFC3339(),
			})
			execution.submitLog("info", "能力重扫完成")
			return actionExecutionResult{Success: true, Detail: map[string]any{
				"executor": "windows-go-agent-runtime", "mode": "capability-rescan", "executionStepId": execution.task.ExecutionStepID,
				"taskId": execution.task.ID, "requestedBy": stringFromMap(payload, "requestedBy"),
			}}
		},
	}
}

func gatewayActionHandler() actionHandler {
	return actionHandlerFunc{
		descriptor: actionHandlerDescriptor{
			ActionType: "gateway.execute", SchemaVersions: []string{"1.0"},
			Aliases: []string{"gateway.probe", "gateway.forward.agent_task", "gateway.forward.direct_control"},
		},
		execute: func(execution *taskExecutionContext) actionExecutionResult {
			success, code, message, detail, handled := executeGatewayTask(execution.ctx, execution.client, execution.config, execution.task, execution.task.Payload)
			if !handled {
				return actionExecutionResult{Success: false, ErrorCode: "ACTION_HANDLER_NOT_REGISTERED", ErrorMessage: "gateway action payload was not handled"}
			}
			return actionExecutionResult{Success: success, ErrorCode: code, ErrorMessage: message, Detail: detail}
		},
	}
}

func selectorKey(selector actionAliasSelector) string {
	keys := make([]string, 0, len(selector.Fields))
	for field := range selector.Fields {
		keys = append(keys, field)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, field := range keys {
		parts = append(parts, normalizeActionName(field)+"="+normalizeActionName(selector.Fields[field]))
	}
	return strings.Join(parts, "&")
}

func normalizeActionName(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func uniqueSortedStrings(values []string) []string {
	seen := map[string]struct{}{}
	result := []string{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	sort.Strings(result)
	return result
}

func nowRFC3339() string {
	return time.Now().Format(time.RFC3339)
}
