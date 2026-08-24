package registry

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"gcac/linux-go-full-agent/internal/compatibility"
)

type Request struct {
	TaskID       string
	Input        map[string]any
	Capabilities map[string]bool
	Resolution   compatibility.Resolution
}

type Result struct {
	Success      bool
	ErrorCode    string
	ErrorMessage string
	Detail       map[string]any
}

type Handler interface {
	ProductAdapterID() string
	Handle(context.Context, Request) Result
}

type HandlerFunc struct {
	AdapterID string
	Execute   func(context.Context, Request) Result
}

func (handler HandlerFunc) ProductAdapterID() string {
	return handler.AdapterID
}

func (handler HandlerFunc) Handle(ctx context.Context, request Request) Result {
	return handler.Execute(ctx, request)
}

type Registry struct {
	handlers map[string]Handler
}

func New() *Registry {
	return &Registry{handlers: map[string]Handler{}}
}

func (registry *Registry) Register(handler Handler) error {
	id := normalize(handler.ProductAdapterID())
	if id == "" {
		return errors.New("product adapter id is required")
	}
	if _, exists := registry.handlers[id]; exists {
		return fmt.Errorf("duplicate product handler: %s", id)
	}
	registry.handlers[id] = handler
	return nil
}

func (registry *Registry) Execute(ctx context.Context, request Request) Result {
	handler, exists := registry.handlers[normalize(request.Resolution.ProductAdapterID)]
	if !exists {
		return Result{ErrorCode: "PRODUCT_HANDLER_NOT_REGISTERED", ErrorMessage: "product handler not registered", Detail: map[string]any{"productAdapterId": request.Resolution.ProductAdapterID}}
	}
	return handler.Handle(ctx, request)
}

func (registry *Registry) AdapterIDs() []string {
	items := make([]string, 0, len(registry.handlers))
	for id := range registry.handlers {
		items = append(items, id)
	}
	sort.Strings(items)
	return items
}

func normalize(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
