package taskruntime

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func TestRunKeepsLifecycleOrder(t *testing.T) {
	steps := []string{}
	outcome, err := Run(context.Background(), Hooks{
		Acknowledge:  func(context.Context) error { steps = append(steps, "ack"); return nil },
		Execute:      func(context.Context) Outcome { steps = append(steps, "execute"); return Outcome{Success: true} },
		Stage:        func(Outcome) error { steps = append(steps, "stage"); return nil },
		Report:       func(context.Context, Outcome) error { steps = append(steps, "report"); return nil },
		MarkReported: func() error { steps = append(steps, "mark"); return nil },
	})
	if err != nil || !outcome.Success {
		t.Fatalf("生命周期执行失败: outcome=%#v err=%v", outcome, err)
	}
	if !reflect.DeepEqual(steps, []string{"ack", "execute", "stage", "report", "mark"}) {
		t.Fatalf("生命周期顺序错误: %#v", steps)
	}
}

func TestRunStopsAfterStageFailure(t *testing.T) {
	reported := false
	_, err := Run(context.Background(), Hooks{
		Acknowledge:  func(context.Context) error { return nil },
		Execute:      func(context.Context) Outcome { return Outcome{Success: false} },
		Stage:        func(Outcome) error { return errors.New("disk full") },
		Report:       func(context.Context, Outcome) error { reported = true; return nil },
		MarkReported: func() error { return nil },
	})
	if err == nil || reported {
		t.Fatalf("暂存失败后不得继续上报: err=%v reported=%v", err, reported)
	}
}
