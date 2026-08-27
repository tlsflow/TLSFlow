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
		"gcac-development-agent-plan-key",
		"wingo.mid.change-me",
		"legacybinarysource",
		"agent.self_test",
		"legacyselectors",
		"actionaliasselector",
		"matchlegacyselectors",
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

func TestMatureWindowsIISScannerUsesBindingInsteadOfPortProbe(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("agent-side-plugins", "windows-runtime-discovery", "windows_runtime_iis.go"))
	if err != nil {
		t.Fatalf("读取 IIS 成熟扫描器源码失败: %v", err)
	}
	lower := strings.ToLower(string(content))
	for _, required := range []string{
		"microsoft.web.administration.servermanager",
		"binding.certificatehash",
		"convert-certsummary",
		"cert:\\localmachine",
	} {
		if !strings.Contains(lower, required) {
			t.Errorf("IIS 成熟扫描器缺少实际 Binding 合同 %q", required)
		}
	}
	for _, forbidden := range []string{"get-webbinding", "netsh http show sslcert", "local-tls-handshake"} {
		if strings.Contains(lower, forbidden) {
			t.Errorf("IIS 扫描器不能使用端口或握手猜测 %q", forbidden)
		}
	}
}

func TestAgentInstallArtifactsDoNotContainLegacyFallbackOrCredentials(t *testing.T) {
	paths := []string{
		filepath.Join("install-service.ps1"),
		filepath.Join("config", "agent.config.template.json"),
	}
	for _, path := range paths {
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("读取安装资源失败 path=%s: %v", path, err)
		}
		lower := strings.ToLower(string(content))
		for _, forbidden := range []string{"legacybinarysource", "windows-go-full-agent.exe", "wingo.mid.change-me", "agent.self_test"} {
			if strings.Contains(lower, forbidden) {
				t.Errorf("安装资源包含禁止内容 %q: %s", forbidden, path)
			}
		}
	}
}
