package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"gcac/linux-go-full-agent/internal/platform/linux/command"
)

type Operation string

const (
	Status   Operation = "status"
	Validate Operation = "validate"
	Reload   Operation = "reload"
	Restart  Operation = "restart"
)

type Controller interface {
	ID() string
	Execute(context.Context, Operation, string, command.Spec) (command.Result, error)
}

type Registry struct {
	controllers map[string]Controller
}

func NewRegistry() *Registry {
	return &Registry{controllers: map[string]Controller{}}
}

func (registry *Registry) Register(controller Controller) error {
	id := normalize(controller.ID())
	if id == "" {
		return errors.New("service controller id is required")
	}
	if _, exists := registry.controllers[id]; exists {
		return fmt.Errorf("duplicate service controller: %s", id)
	}
	registry.controllers[id] = controller
	return nil
}

func (registry *Registry) Resolve(capabilityIDs []string) (Controller, error) {
	matches := make([]Controller, 0, len(capabilityIDs))
	seen := map[string]struct{}{}
	for _, capabilityID := range capabilityIDs {
		id := normalize(capabilityID)
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		if controller, exists := registry.controllers[id]; exists {
			matches = append(matches, controller)
		}
	}
	if len(matches) == 0 {
		return nil, errors.New("service controller not registered")
	}
	if len(matches) > 1 {
		ids := make([]string, 0, len(matches))
		for _, controller := range matches {
			ids = append(ids, controller.ID())
		}
		sort.Strings(ids)
		return nil, fmt.Errorf("ambiguous service controllers: %s", strings.Join(ids, ","))
	}
	return matches[0], nil
}

type commandController struct {
	id     string
	binary string
	runner command.Runner
	args   func(Operation, string) []string
}

func (controller commandController) ID() string {
	return controller.id
}

func (controller commandController) Execute(ctx context.Context, operation Operation, serviceName string, validation command.Spec) (command.Result, error) {
	if operation == Validate {
		if strings.TrimSpace(validation.Name) == "" {
			return command.Result{}, errors.New("validation command is required")
		}
		return controller.runner.Run(ctx, validation)
	}
	if strings.TrimSpace(serviceName) == "" {
		return command.Result{}, errors.New("service name is required")
	}
	args := controller.args(operation, serviceName)
	if len(args) == 0 {
		return command.Result{}, fmt.Errorf("unsupported service operation: %s", operation)
	}
	return controller.runner.Run(ctx, command.Spec{Name: controller.binary, Args: args})
}

func NewSystemd(runner command.Runner) Controller {
	return commandController{id: "linux.systemd.v1", binary: "systemctl", runner: runner, args: func(operation Operation, serviceName string) []string {
		action := map[Operation]string{Status: "is-active", Reload: "reload", Restart: "restart"}[operation]
		if action == "" {
			return nil
		}
		return []string{action, serviceName}
	}}
}

func NewSysV(runner command.Runner) Controller {
	return commandController{id: "linux.sysv.v1", binary: "service", runner: runner, args: func(operation Operation, serviceName string) []string {
		action := map[Operation]string{Status: "status", Reload: "reload", Restart: "restart"}[operation]
		if action == "" {
			return nil
		}
		return []string{serviceName, action}
	}}
}

func NewOpenRC(runner command.Runner) Controller {
	return commandController{id: "linux.openrc.v1", binary: "rc-service", runner: runner, args: func(operation Operation, serviceName string) []string {
		action := map[Operation]string{Status: "status", Reload: "reload", Restart: "restart"}[operation]
		if action == "" {
			return nil
		}
		return []string{serviceName, action}
	}}
}

func normalize(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
