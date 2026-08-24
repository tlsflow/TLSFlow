package runtime

import (
	"context"
	"errors"
	"time"
)

type Schedule struct {
	Heartbeat time.Duration
	TaskPoll  time.Duration
	Health    time.Duration
	Rescan    time.Duration
}

type Hooks struct {
	Heartbeat func(context.Context, time.Time)
	TaskPoll  func(context.Context, time.Time)
	Health    func(context.Context, time.Time)
	Rescan    func(context.Context, time.Time)
	Stop      func(context.Context)
}

func Run(ctx context.Context, schedule Schedule, hooks Hooks) error {
	if err := validate(schedule, hooks); err != nil {
		return err
	}
	heartbeat := time.NewTicker(schedule.Heartbeat)
	taskPoll := time.NewTicker(schedule.TaskPoll)
	health := time.NewTicker(schedule.Health)
	defer heartbeat.Stop()
	defer taskPoll.Stop()
	defer health.Stop()

	var rescan *time.Ticker
	if schedule.Rescan > 0 {
		rescan = time.NewTicker(schedule.Rescan)
		defer rescan.Stop()
	}
	for {
		select {
		case <-ctx.Done():
			hooks.Stop(context.Background())
			return nil
		case now := <-heartbeat.C:
			hooks.Heartbeat(ctx, now)
		case now := <-taskPoll.C:
			hooks.TaskPoll(ctx, now)
		case now := <-health.C:
			hooks.Health(ctx, now)
		case now := <-tickerChannel(rescan):
			hooks.Rescan(ctx, now)
		}
	}
}

func validate(schedule Schedule, hooks Hooks) error {
	if schedule.Heartbeat <= 0 || schedule.TaskPoll <= 0 || schedule.Health <= 0 {
		return errors.New("runtime schedule intervals must be positive")
	}
	if hooks.Heartbeat == nil || hooks.TaskPoll == nil || hooks.Health == nil || hooks.Rescan == nil || hooks.Stop == nil {
		return errors.New("runtime scheduler hooks are incomplete")
	}
	return nil
}

func tickerChannel(ticker *time.Ticker) <-chan time.Time {
	if ticker == nil {
		return nil
	}
	return ticker.C
}
