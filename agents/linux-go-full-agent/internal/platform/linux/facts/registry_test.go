package facts

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestRegistryRejectsDuplicateCollector(t *testing.T) {
	registry := New()
	collector := CollectorFunc{CollectorName: "runtime", Execute: func(context.Context) (any, error) { return nil, nil }}
	if err := registry.Register(collector); err != nil {
		t.Fatal(err)
	}
	if err := registry.Register(collector); err == nil {
		t.Fatal("重复 Collector 必须失败")
	}
}

func TestRegistryKeepsPartialResults(t *testing.T) {
	registry := New()
	_ = registry.Register(CollectorFunc{CollectorName: "success", Execute: func(context.Context) (any, error) { return "ok", nil }})
	_ = registry.Register(CollectorFunc{CollectorName: "failed", Execute: func(context.Context) (any, error) { return nil, errors.New("boom") }})
	snapshot := registry.Collect(context.Background())
	if snapshot.Facts["success"] != "ok" {
		t.Fatalf("成功事实丢失: %#v", snapshot.Facts)
	}
	if snapshot.Errors["failed"] != "boom" {
		t.Fatalf("失败事实未保留 unknown 证据: %#v", snapshot.Errors)
	}
}

func TestRegistryAppliesCollectorTimeout(t *testing.T) {
	registry := New()
	_ = registry.Register(CollectorFunc{
		CollectorName:    "slow",
		CollectorTimeout: 5 * time.Millisecond,
		Execute: func(ctx context.Context) (any, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		},
	})
	snapshot := registry.Collect(context.Background())
	if snapshot.Errors["slow"] == "" {
		t.Fatal("超时必须记录为采集错误")
	}
}

func TestRegistryNamesAreDeterministic(t *testing.T) {
	registry := New()
	for _, name := range []string{"security", "runtime", "filesystem"} {
		_ = registry.Register(CollectorFunc{CollectorName: name, Execute: func(context.Context) (any, error) { return nil, nil }})
	}
	if !reflect.DeepEqual(registry.Names(), []string{"filesystem", "runtime", "security"}) {
		t.Fatalf("Collector 顺序不稳定: %#v", registry.Names())
	}
}
