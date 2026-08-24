package buildinfo

import "testing"

func TestCurrentIncludesRuntimeBaseline(t *testing.T) {
	info := Current()
	if info.Name != "gcac-linux-agent" {
		t.Fatalf("名称不正确: %s", info.Name)
	}
	if info.MinimumKernel != "3.2" {
		t.Fatalf("最低 Kernel 基线不正确: %s", info.MinimumKernel)
	}
	if info.CGOEnabled {
		t.Fatal("正式构建必须声明 CGO 关闭")
	}
	if info.LibcRequirement != "none-static-go" {
		t.Fatalf("libc 约束不正确: %s", info.LibcRequirement)
	}
}
