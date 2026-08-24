package securitymodule

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"gcac/linux-go-full-agent/internal/platform/linux/command"
)

type Adapter interface {
	ID() string
	RestoreFileContext(context.Context, string) error
}

type adapter struct {
	id      string
	runner  command.Runner
	command string
}

func (current adapter) ID() string {
	return current.id
}

func (current adapter) RestoreFileContext(ctx context.Context, path string) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("security module path is required")
	}
	if current.command == "" {
		return nil
	}
	_, err := current.runner.Run(ctx, command.Spec{Name: current.command, Args: []string{path}})
	return err
}

func NewSELinux(runner command.Runner) Adapter {
	return adapter{id: "linux.security.selinux.v1", runner: runner, command: "restorecon"}
}

func NewAppArmor(runner command.Runner) Adapter {
	return adapter{id: "linux.security.apparmor.v1", runner: runner}
}

func NewNone(runner command.Runner) Adapter {
	return adapter{id: "linux.security.none.v1", runner: runner}
}

type Registry struct {
	adapters map[string]Adapter
}

func NewRegistry() *Registry {
	return &Registry{adapters: map[string]Adapter{}}
}

func (registry *Registry) Register(adapter Adapter) error {
	id := normalize(adapter.ID())
	if _, exists := registry.adapters[id]; exists {
		return fmt.Errorf("duplicate security module adapter: %s", id)
	}
	registry.adapters[id] = adapter
	return nil
}

func (registry *Registry) Resolve(capabilityIDs []string) (Adapter, error) {
	matches := []Adapter{}
	for _, capabilityID := range capabilityIDs {
		if adapter, exists := registry.adapters[normalize(capabilityID)]; exists {
			matches = append(matches, adapter)
		}
	}
	if len(matches) == 0 {
		return nil, errors.New("security module adapter not registered")
	}
	if len(matches) > 1 {
		ids := make([]string, 0, len(matches))
		for _, adapter := range matches {
			ids = append(ids, adapter.ID())
		}
		sort.Strings(ids)
		return nil, fmt.Errorf("ambiguous security module adapters: %s", strings.Join(ids, ","))
	}
	return matches[0], nil
}

func normalize(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
