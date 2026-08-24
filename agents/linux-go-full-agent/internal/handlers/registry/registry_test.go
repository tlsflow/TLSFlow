package registry

import (
	"context"
	"reflect"
	"testing"

	"gcac/linux-go-full-agent/internal/compatibility"
)

func TestRegistryDispatchesByPublicProductAdapterID(t *testing.T) {
	registry := New()
	if err := registry.Register(HandlerFunc{AdapterID: compatibility.ProductApache, Execute: func(context.Context, Request) Result {
		return Result{Success: true}
	}}); err != nil {
		t.Fatal(err)
	}
	result := registry.Execute(context.Background(), Request{Resolution: compatibility.Resolution{ProductAdapterID: compatibility.ProductApache}})
	if !result.Success {
		t.Fatalf("公共 Product Adapter ID 未路由: %#v", result)
	}
}

func TestRegistryRejectsDuplicateAndKeepsOrder(t *testing.T) {
	registry := New()
	for _, id := range []string{compatibility.ProductTomcat, compatibility.ProductApache} {
		if err := registry.Register(HandlerFunc{AdapterID: id, Execute: func(context.Context, Request) Result { return Result{} }}); err != nil {
			t.Fatal(err)
		}
	}
	if err := registry.Register(HandlerFunc{AdapterID: compatibility.ProductApache}); err == nil {
		t.Fatal("重复产品处理器必须失败")
	}
	if !reflect.DeepEqual(registry.AdapterIDs(), []string{compatibility.ProductApache, compatibility.ProductTomcat}) {
		t.Fatalf("产品处理器顺序不稳定: %#v", registry.AdapterIDs())
	}
}
