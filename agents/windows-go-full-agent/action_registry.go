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

type actionHandlerDescriptor struct {
	ActionType     string
	SchemaVersions []string
	DirectControl  bool
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
	Handler       actionHandler
	ActionType    string
	SchemaVersion string
}

type actionRegistryError struct {
	Code    string
	Message string
}

func (e *actionRegistryError) Error() string {
	return e.Message
}

type actionHandlerRegistry struct {
	handlers map[string]actionHandler
}

var windowsActionHandlers = mustBuildWindowsActionHandlerRegistry()

func newActionHandlerRegistry(handlers ...actionHandler) (*actionHandlerRegistry, error) {
	registry := &actionHandlerRegistry{
		handlers: map[string]actionHandler{},
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
		v2ActionHandler(agentFactCollect),
		v2ActionHandler(agentPlanValidate),
		v2ActionHandler(agentPlanExecute),
		v2ActionHandler(agentExecutionReceipt),
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
	return nil
}

func (r *actionHandlerRegistry) Resolve(payload map[string]any) (*resolvedActionHandler, error) {
	requestedType := strings.TrimSpace(stringFromMap(payload, "actionType"))
	if requestedType == "" {
		return nil, &actionRegistryError{Code: "ACTION_TYPE_REQUIRED", Message: "canonical actionType is required"}
	}
	actionType := normalizeActionName(requestedType)
	handler, exists := r.handlers[actionType]
	if !exists {
		return nil, &actionRegistryError{Code: "ACTION_HANDLER_NOT_REGISTERED", Message: fmt.Sprintf("action handler not registered: %s", requestedType)}
	}
	schemaVersion := firstNonEmpty(stringFromMap(payload, "actionSchemaVersion"), "1.0")
	if !containsString(handler.Descriptor().SchemaVersions, schemaVersion) {
		return nil, &actionRegistryError{Code: "ACTION_SCHEMA_UNSUPPORTED", Message: fmt.Sprintf("unsupported action schema %s for %s", schemaVersion, requestedType)}
	}
	return &resolvedActionHandler{
		Handler:       handler,
		ActionType:    actionType,
		SchemaVersion: schemaVersion,
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
	result.Detail["actionSchemaVersion"] = resolved.SchemaVersion
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
	}
	values = uniqueSortedStrings(values)
	return values
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
