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
	if err := registry.Register(successfulHandler("linux.nginx.deploy_certificate")); err != nil {
		t.Fatal(err)
	}
	if err := registry.Register(successfulHandler("LINUX.NGINX.DEPLOY_CERTIFICATE")); err == nil {
		t.Fatal("重复 Action ID 必须失败")
	}
}

func TestRegistryReturnsStableUnknownActionError(t *testing.T) {
	result := New().Execute(context.Background(), Request{TaskID: "task-1", ActionType: "unknown.action"})
	if result.ErrorCode != "ACTION_HANDLER_NOT_REGISTERED" {
		t.Fatalf("错误码不正确: %s", result.ErrorCode)
	}
}

func TestRegistryResolvesAliasAndMiddleware(t *testing.T) {
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
	if err := registry.Register(successfulHandler("linux.nginx.deploy_certificate")); err != nil {
		t.Fatal(err)
	}
	if err := registry.RegisterAlias("linux.nginx.deploy", "linux.nginx.deploy_certificate", "v1"); err != nil {
		t.Fatal(err)
	}
	result := registry.Execute(context.Background(), Request{ActionType: "linux.nginx.deploy"})
	if !result.Success {
		t.Fatal("Alias 应解析到目标 Handler")
	}
	if !reflect.DeepEqual(called, []string{"linux.nginx.deploy"}) {
		t.Fatalf("中间件未按预期执行: %#v", called)
	}
}

func TestRegistrySupportsCrossVersionAlias(t *testing.T) {
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
	if err := registry.RegisterAliasDescriptor(
		Descriptor{ActionType: "linux.nginx.deploy_certificate", SchemaVersion: "v1"},
		Descriptor{ActionType: "certificate.deploy", SchemaVersion: "1.0"},
	); err != nil {
		t.Fatal(err)
	}
	result := registry.Execute(context.Background(), Request{ActionType: "linux.nginx.deploy_certificate"})
	if !result.Success {
		t.Fatalf("跨版本别名未路由到规范动作: %#v", result)
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
