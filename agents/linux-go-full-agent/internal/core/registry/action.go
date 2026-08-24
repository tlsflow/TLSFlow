package registry

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
)

const DefaultSchemaVersion = "v1"

var ErrHandlerNotRegistered = errors.New("action handler not registered")

type Request struct {
	TaskID        string
	ActionType    string
	SchemaVersion string
	Payload       map[string]any
}

type Result struct {
	Success      bool
	ErrorCode    string
	ErrorMessage string
	Detail       map[string]any
}

type Descriptor struct {
	ActionType    string
	SchemaVersion string
}

type Handler interface {
	Descriptor() Descriptor
	Handle(context.Context, Request) Result
}

type HandlerFunc struct {
	ActionType    string
	SchemaVersion string
	Execute       func(context.Context, Request) Result
}

func (handler HandlerFunc) Descriptor() Descriptor {
	return Descriptor{ActionType: handler.ActionType, SchemaVersion: handler.SchemaVersion}
}

func (handler HandlerFunc) Handle(ctx context.Context, request Request) Result {
	return handler.Execute(ctx, request)
}

type Middleware func(Handler) Handler

type Registry struct {
	handlers   map[string]Handler
	aliases    map[string]string
	middleware []Middleware
}

func New(middleware ...Middleware) *Registry {
	return &Registry{
		handlers:   map[string]Handler{},
		aliases:    map[string]string{},
		middleware: append([]Middleware(nil), middleware...),
	}
}

func (registry *Registry) Register(handler Handler) error {
	descriptor := normalizeDescriptor(handler.Descriptor())
	if descriptor.ActionType == "" {
		return errors.New("action type is required")
	}
	key := descriptorKey(descriptor.ActionType, descriptor.SchemaVersion)
	if _, exists := registry.handlers[key]; exists {
		return fmt.Errorf("duplicate action handler: %s", key)
	}
	wrapped := handler
	for index := len(registry.middleware) - 1; index >= 0; index-- {
		wrapped = registry.middleware[index](wrapped)
	}
	registry.handlers[key] = wrapped
	return nil
}

func (registry *Registry) RegisterAlias(aliasActionType, targetActionType, schemaVersion string) error {
	return registry.RegisterAliasDescriptor(
		Descriptor{ActionType: aliasActionType, SchemaVersion: schemaVersion},
		Descriptor{ActionType: targetActionType, SchemaVersion: schemaVersion},
	)
}

func (registry *Registry) RegisterAliasDescriptor(alias, target Descriptor) error {
	aliasKey := descriptorKey(alias.ActionType, alias.SchemaVersion)
	targetKey := descriptorKey(target.ActionType, target.SchemaVersion)
	if aliasKey == targetKey {
		return errors.New("action alias cannot target itself")
	}
	if _, exists := registry.handlers[aliasKey]; exists {
		return fmt.Errorf("action alias conflicts with handler: %s", aliasKey)
	}
	if _, exists := registry.aliases[aliasKey]; exists {
		return fmt.Errorf("duplicate action alias: %s", aliasKey)
	}
	registry.aliases[aliasKey] = targetKey
	return nil
}

func (registry *Registry) Execute(ctx context.Context, request Request) Result {
	handler, err := registry.Lookup(request.ActionType, request.SchemaVersion)
	if err != nil {
		return Result{
			Success:      false,
			ErrorCode:    "ACTION_HANDLER_NOT_REGISTERED",
			ErrorMessage: fmt.Sprintf("action handler not registered: %s", strings.TrimSpace(request.ActionType)),
			Detail: map[string]any{
				"taskId":        request.TaskID,
				"actionType":    strings.TrimSpace(request.ActionType),
				"schemaVersion": normalizeSchemaVersion(request.SchemaVersion),
			},
		}
	}
	request.ActionType = normalizeActionType(request.ActionType)
	request.SchemaVersion = normalizeSchemaVersion(request.SchemaVersion)
	return handler.Handle(ctx, request)
}

func (registry *Registry) Lookup(actionType, schemaVersion string) (Handler, error) {
	key := descriptorKey(actionType, schemaVersion)
	visited := map[string]struct{}{}
	for {
		if _, exists := visited[key]; exists {
			return nil, fmt.Errorf("action alias cycle: %s", key)
		}
		visited[key] = struct{}{}
		if handler, exists := registry.handlers[key]; exists {
			return handler, nil
		}
		target, exists := registry.aliases[key]
		if !exists {
			return nil, ErrHandlerNotRegistered
		}
		key = target
	}
}

func (registry *Registry) Descriptors() []Descriptor {
	items := make([]Descriptor, 0, len(registry.handlers))
	for _, handler := range registry.handlers {
		items = append(items, normalizeDescriptor(handler.Descriptor()))
	}
	sort.Slice(items, func(left, right int) bool {
		if items[left].ActionType == items[right].ActionType {
			return items[left].SchemaVersion < items[right].SchemaVersion
		}
		return items[left].ActionType < items[right].ActionType
	})
	return items
}

func normalizeDescriptor(descriptor Descriptor) Descriptor {
	descriptor.ActionType = normalizeActionType(descriptor.ActionType)
	descriptor.SchemaVersion = normalizeSchemaVersion(descriptor.SchemaVersion)
	return descriptor
}

func descriptorKey(actionType, schemaVersion string) string {
	return normalizeActionType(actionType) + "@" + normalizeSchemaVersion(schemaVersion)
}

func normalizeActionType(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizeSchemaVersion(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return DefaultSchemaVersion
	}
	return value
}
