package facts

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

type Result struct {
	Name  string
	Value any
	Error error
}

type Collector interface {
	Name() string
	Timeout() time.Duration
	Collect(context.Context) (any, error)
}

type CollectorFunc struct {
	CollectorName    string
	CollectorTimeout time.Duration
	Execute          func(context.Context) (any, error)
}

func (collector CollectorFunc) Name() string {
	return collector.CollectorName
}

func (collector CollectorFunc) Timeout() time.Duration {
	return collector.CollectorTimeout
}

func (collector CollectorFunc) Collect(ctx context.Context) (any, error) {
	return collector.Execute(ctx)
}

type Snapshot struct {
	CollectedAt string            `json:"collectedAt"`
	Facts       map[string]any    `json:"facts"`
	Errors      map[string]string `json:"errors,omitempty"`
}

type Registry struct {
	collectors map[string]Collector
}

func New() *Registry {
	return &Registry{collectors: map[string]Collector{}}
}

func (registry *Registry) Register(collector Collector) error {
	name := normalizeName(collector.Name())
	if name == "" {
		return fmt.Errorf("fact collector name is required")
	}
	if _, exists := registry.collectors[name]; exists {
		return fmt.Errorf("duplicate fact collector: %s", name)
	}
	registry.collectors[name] = collector
	return nil
}

func (registry *Registry) Names() []string {
	names := make([]string, 0, len(registry.collectors))
	for name := range registry.collectors {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func (registry *Registry) Collect(ctx context.Context) Snapshot {
	names := registry.Names()
	results := make(chan Result, len(names))
	var waitGroup sync.WaitGroup
	for _, name := range names {
		collector := registry.collectors[name]
		waitGroup.Add(1)
		go func(collectorName string, current Collector) {
			defer waitGroup.Done()
			collectorCtx := ctx
			cancel := func() {}
			if timeout := current.Timeout(); timeout > 0 {
				collectorCtx, cancel = context.WithTimeout(ctx, timeout)
			}
			defer cancel()
			value, err := current.Collect(collectorCtx)
			results <- Result{Name: collectorName, Value: value, Error: err}
		}(name, collector)
	}
	waitGroup.Wait()
	close(results)

	snapshot := Snapshot{
		CollectedAt: time.Now().UTC().Format(time.RFC3339),
		Facts:       map[string]any{},
		Errors:      map[string]string{},
	}
	for result := range results {
		if result.Error != nil {
			snapshot.Errors[result.Name] = result.Error.Error()
			continue
		}
		snapshot.Facts[result.Name] = result.Value
	}
	if len(snapshot.Errors) == 0 {
		snapshot.Errors = nil
	}
	return snapshot
}

func normalizeName(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
