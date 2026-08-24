package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

var forbiddenDistributionPattern = regexp.MustCompile(`(?i)\b(ubuntu|debian|rhel|centos|fedora|alpine|suse)\b`)
var forbiddenProductVersionPattern = regexp.MustCompile(`(?i)\b(nginx|apache|tomcat)\w*version\b`)

func TestArchitectureGuardRejectsDistributionAndProductVersionDispatch(t *testing.T) {
	root := "."
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		return inspectGuardedFile(t, path)
	})
	if err != nil {
		t.Fatalf("架构守卫扫描失败: %v", err)
	}
}

func inspectGuardedFile(t *testing.T, path string) error {
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, path, nil, 0)
	if err != nil {
		return err
	}
	ast.Inspect(file, func(node ast.Node) bool {
		var expression ast.Expr
		switch statement := node.(type) {
		case *ast.IfStmt:
			expression = statement.Cond
		case *ast.SwitchStmt:
			expression = statement.Tag
		}
		if expression == nil {
			return true
		}
		start := fileSet.Position(expression.Pos()).Offset
		end := fileSet.Position(expression.End()).Offset
		content, readErr := os.ReadFile(path)
		if readErr != nil || start < 0 || end > len(content) || start >= end {
			return true
		}
		condition := string(content[start:end])
		if forbiddenDistributionPattern.MatchString(condition) {
			t.Errorf("%s 禁止按发行版名称分派: %s", path, condition)
		}
		if forbiddenProductVersionPattern.MatchString(condition) {
			t.Errorf("%s 禁止按产品版本分派: %s", path, condition)
		}
		return true
	})
	return nil
}

func TestArchitectureGuardHasNoDistributionSpecificAgentTrees(t *testing.T) {
	for _, name := range []string{"ubuntu", "debian", "rhel", "centos", "fedora", "alpine", "suse"} {
		path := filepath.Join("..", "linux-go-full-agent-"+name)
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("禁止创建发行版专用 Agent 工程: %s", path)
		}
	}
}
