package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestArchitectureGuardScansProductionGoSources(t *testing.T) {
	forbidden := []string{
		"agent.atomic_plan.execute",
		"exec --shell",
		"/bin/sh -c",
		"powershell.exe",
		"gcac-development-agent-plan-key",
		"agent.self_test",
		"buildstableagentkey",
		"stableagentkey",
		"nginx",
		"apache",
		"tomcat",
		"iis",
	}
	err := filepath.WalkDir(".", func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		lower := strings.ToLower(string(content))
		for _, value := range forbidden {
			if strings.Contains(lower, value) {
				t.Errorf("生产源码包含禁止内容 %q: %s", value, path)
			}
		}
		if strings.Contains(lower, "command.execute\"") || strings.Contains(lower, "command.execute'") {
			t.Errorf("生产源码包含自由 command.execute: %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("架构守卫扫描失败: %v", err)
	}
}

func TestAgentTemplateDoesNotShipCredentials(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("config", "agent.config.template.json"))
	if err != nil {
		t.Fatalf("读取配置模板失败: %v", err)
	}
	lower := strings.ToLower(string(content))
	if strings.Contains(lower, "change_me_agent_key") || strings.Contains(lower, "linuxgo.mid.") {
		t.Fatal("配置模板不得包含默认 Agent Key")
	}
}

func TestArchitectureGuardHasNoDistributionSpecificAgentTrees(t *testing.T) {
	for _, name := range []string{"ubuntu", "debian", "rhel", "centos", "fedora", "alpine", "suse"} {
		path := filepath.Join("..", "linux-go-full-agent-"+name)
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("禁止创建发行版专用 Agent 工程: %s", path)
		}
	}
}
