package runtime

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestRunSchedulesHooksAndStops(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	called := map[string]int{}
	var mutex sync.Mutex
	record := func(name string) {
		mutex.Lock()
		called[name]++
		shouldStop := called["heartbeat"] > 0 && called["task"] > 0 && called["health"] > 0 && called["rescan"] > 0
		mutex.Unlock()
		if shouldStop {
			cancel()
		}
	}
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, Schedule{
			Heartbeat: time.Millisecond,
			TaskPoll:  time.Millisecond,
			Health:    time.Millisecond,
			Rescan:    time.Millisecond,
		}, Hooks{
			Heartbeat: func(context.Context, time.Time) { record("heartbeat") },
			TaskPoll:  func(context.Context, time.Time) { record("task") },
			Health:    func(context.Context, time.Time) { record("health") },
			Rescan:    func(context.Context, time.Time) { record("rescan") },
			Stop:      func(context.Context) { record("stop") },
		})
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("scheduler did not stop")
	}
	mutex.Lock()
	defer mutex.Unlock()
	for _, name := range []string{"heartbeat", "task", "health", "rescan", "stop"} {
		if called[name] == 0 {
			t.Fatalf("hook not called: %s", name)
		}
	}
}

func TestRunRejectsIncompleteHooks(t *testing.T) {
	err := Run(context.Background(), Schedule{Heartbeat: time.Second, TaskPoll: time.Second, Health: time.Second}, Hooks{})
	if err == nil {
		t.Fatal("incomplete hooks must fail")
	}
}
