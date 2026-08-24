package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStartupFailsWithMigrationMessage(t *testing.T) {
	err := startupError()
	if err == nil {
		t.Fatal("退役程序不得成功启动")
	}
	if !strings.Contains(err.Error(), "Plugin Runner/Agent v2") {
		t.Fatalf("启动错误必须明确迁移目标，实际为：%v", err)
	}
}

func TestOnlyStartupStubRemains(t *testing.T) {
	entries, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("退役目录只应保留启动壳和负向测试，实际文件为：%v", entries)
	}
	for _, entry := range entries {
		if entry == "main_test.go" {
			continue
		}
		if entry != "main.go" {
			t.Fatalf("发现未允许的 Go 源文件：%s", entry)
		}
	}
}

func TestStartupStubHasNoOperationalImports(t *testing.T) {
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, "main.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{"errors": true, "fmt": true, "os": true}
	for _, spec := range file.Imports {
		path := strings.Trim(spec.Path.Value, `"`)
		if !allowed[path] {
			t.Fatalf("启动壳包含未允许的运行时依赖：%s", path)
		}
	}
}

func TestNoLegacyConfigurationOrSidecarFiles(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == "main.go" || entry.Name() == "main_test.go" || entry.Name() == "README.md" || entry.Name() == "go.mod" || entry.Name() == "gcac-adcs-agent.exe" {
			continue
		}
		t.Fatalf("退役目录不得保留配置、脚本或旁路文件：%s", entry.Name())
	}
}

func TestMainPackageIsNotAccidentallyChanged(t *testing.T) {
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, "main.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	if file.Name.Name != "main" {
		t.Fatalf("启动壳必须保持 main 包，实际为：%s", file.Name.Name)
	}
	if _, ok := file.Decls[0].(*ast.GenDecl); !ok {
		t.Fatal("启动壳结构异常")
	}
}
