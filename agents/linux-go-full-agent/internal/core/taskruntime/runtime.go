package taskruntime

import (
	"context"
	"errors"
	"fmt"
)

type Outcome struct {
	Success      bool
	ErrorCode    string
	ErrorMessage string
	Detail       map[string]any
}

type Hooks struct {
	Acknowledge  func(context.Context) error
	Execute      func(context.Context) Outcome
	Stage        func(Outcome) error
	Report       func(context.Context, Outcome) error
	MarkReported func() error
}

func Run(ctx context.Context, hooks Hooks) (Outcome, error) {
	if hooks.Acknowledge == nil || hooks.Execute == nil || hooks.Stage == nil || hooks.Report == nil || hooks.MarkReported == nil {
		return Outcome{}, errors.New("task runtime hooks are incomplete")
	}
	if err := hooks.Acknowledge(ctx); err != nil {
		return Outcome{}, fmt.Errorf("ack task failed: %w", err)
	}
	outcome := hooks.Execute(ctx)
	if err := hooks.Stage(outcome); err != nil {
		return outcome, fmt.Errorf("stage task result failed: %w", err)
	}
	if err := hooks.Report(ctx, outcome); err != nil {
		return outcome, fmt.Errorf("report task result failed: %w", err)
	}
	if err := hooks.MarkReported(); err != nil {
		return outcome, fmt.Errorf("mark task result reported failed: %w", err)
	}
	return outcome, nil
}
