package privilege

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"gcac/linux-go-full-agent/internal/platform/linux/command"
)

type Adapter interface {
	ID() string
	Execute(context.Context, command.Spec) (command.Result, error)
}

type Policy struct {
	AllowedExecutables []string
}

func (policy Policy) Allows(name string) bool {
	cleanName := filepath.Clean(strings.TrimSpace(name))
	for _, allowed := range policy.AllowedExecutables {
		if cleanName == filepath.Clean(strings.TrimSpace(allowed)) {
			return true
		}
	}
	return false
}

type adapter struct {
	id     string
	prefix []string
	runner command.Runner
	policy Policy
}

func (current adapter) ID() string {
	return current.id
}

func (current adapter) Execute(ctx context.Context, spec command.Spec) (command.Result, error) {
	if !current.policy.Allows(spec.Name) {
		return command.Result{}, fmt.Errorf("privilege command not allowed: %s", spec.Name)
	}
	if len(current.prefix) == 0 {
		return current.runner.Run(ctx, spec)
	}
	args := append([]string{}, current.prefix[1:]...)
	args = append(args, spec.Name)
	args = append(args, spec.Args...)
	spec.Name = current.prefix[0]
	spec.Args = args
	return current.runner.Run(ctx, spec)
}

func NewRoot(runner command.Runner, policy Policy) Adapter {
	return adapter{id: "linux.privilege.root.v1", runner: runner, policy: policy}
}

func NewSudo(runner command.Runner, policy Policy) Adapter {
	return adapter{id: "linux.privilege.sudo-noninteractive.v1", prefix: []string{"sudo", "-n", "--"}, runner: runner, policy: policy}
}

func NewDoas(runner command.Runner, policy Policy) Adapter {
	return adapter{id: "linux.privilege.doas-noninteractive.v1", prefix: []string{"doas", "-n", "--"}, runner: runner, policy: policy}
}

type Registry struct {
	adapters map[string]Adapter
}

func NewRegistry() *Registry {
	return &Registry{adapters: map[string]Adapter{}}
}

func (registry *Registry) Register(adapter Adapter) error {
	id := normalize(adapter.ID())
	if id == "" {
		return errors.New("privilege adapter id is required")
	}
	if _, exists := registry.adapters[id]; exists {
		return fmt.Errorf("duplicate privilege adapter: %s", id)
	}
	registry.adapters[id] = adapter
	return nil
}

func (registry *Registry) Resolve(capabilityIDs []string) (Adapter, error) {
	matches := make([]Adapter, 0, len(capabilityIDs))
	for _, capabilityID := range capabilityIDs {
		if adapter, exists := registry.adapters[normalize(capabilityID)]; exists {
			matches = append(matches, adapter)
		}
	}
	if len(matches) == 0 {
		return nil, errors.New("privilege adapter not registered")
	}
	if len(matches) > 1 {
		ids := make([]string, 0, len(matches))
		for _, adapter := range matches {
			ids = append(ids, adapter.ID())
		}
		sort.Strings(ids)
		return nil, fmt.Errorf("ambiguous privilege adapters: %s", strings.Join(ids, ","))
	}
	return matches[0], nil
}

func normalize(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
