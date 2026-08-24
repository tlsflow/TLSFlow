package registry

import (
	"context"
	"reflect"
	"testing"
)

func successfulHandler(actionType string) HandlerFunc {
	return HandlerFunc{
		ActionType: actionType,
		Execute: func(context.Context, Request) Result {
			return Result{Success: true}
		},
	}
}

func TestRegistryRejectsDuplicateHandler(t *testing.T) {
	registry := New()
	if err := registry.Register(successfulHandler("legacy.deploy_certificate")); err != nil {
		t.Fatal(err)
	}
	if err := registry.Register(successfulHandler("LEGACY.DEPLOY_CERTIFICATE")); err == nil {
		t.Fatal("重复 Action ID 必须失败")
	}
}

func TestRegistryReturnsStableUnknownActionError(t *testing.T) {
	result := New().Execute(context.Background(), Request{TaskID: "task-1", ActionType: "unknown.action"})
	if result.ErrorCode != "ACTION_HANDLER_NOT_REGISTERED" {
		t.Fatalf("错误码不正确: %s", result.ErrorCode)
	}
}

func TestRegistryResolvesCanonicalActionAndMiddleware(t *testing.T) {
	called := []string{}
	middleware := func(next Handler) Handler {
		return HandlerFunc{
			ActionType:    next.Descriptor().ActionType,
			SchemaVersion: next.Descriptor().SchemaVersion,
			Execute: func(ctx context.Context, request Request) Result {
				called = append(called, request.ActionType)
				return next.Handle(ctx, request)
			},
		}
	}
	registry := New(middleware)
	if err := registry.Register(successfulHandler("certificate.deploy")); err != nil {
		t.Fatal(err)
	}
	result := registry.Execute(context.Background(), Request{ActionType: "certificate.deploy"})
	if !result.Success {
		t.Fatal("规范 Action 必须路由到已登记 Handler")
	}
	if !reflect.DeepEqual(called, []string{"certificate.deploy"}) {
		t.Fatalf("中间件未按预期执行: %#v", called)
	}
}

func TestRegistryRejectsUnregisteredActionAcrossSchemaVersions(t *testing.T) {
	registry := New()
	if err := registry.Register(HandlerFunc{
		ActionType:    "certificate.deploy",
		SchemaVersion: "1.0",
		Execute: func(context.Context, Request) Result {
			return Result{Success: true}
		},
	}); err != nil {
		t.Fatal(err)
	}
	result := registry.Execute(context.Background(), Request{ActionType: "legacy.deploy_certificate", SchemaVersion: "1.0"})
	if result.Success || result.ErrorCode != "ACTION_HANDLER_NOT_REGISTERED" {
		t.Fatalf("未登记旧 Action 必须失败关闭: %#v", result)
	}
}

func TestRegistryDescriptorsAreDeterministic(t *testing.T) {
	registry := New()
	for _, actionType := range []string{"z.action", "a.action", "m.action"} {
		if err := registry.Register(successfulHandler(actionType)); err != nil {
			t.Fatal(err)
		}
	}
	items := registry.Descriptors()
	actual := []string{items[0].ActionType, items[1].ActionType, items[2].ActionType}
	if !reflect.DeepEqual(actual, []string{"a.action", "m.action", "z.action"}) {
		t.Fatalf("注册表顺序不稳定: %#v", actual)
	}
}
