package main

import "testing"

func TestFormatWindowsSystemVersionPrefersProductAndDisplayVersion(t *testing.T) {
	got := formatWindowsSystemVersion(&windowsOSDetail{
		ProductName:    "Windows Server 2022 Datacenter",
		DisplayVersion: "21H2",
		CurrentBuild:   "20348",
		BuildRevision:  "20348.2402",
		Version:        "10.0.20348",
	})
	if got != "Windows Server 2022 Datacenter 21H2" {
		t.Fatalf("系统版本格式不正确: %q", got)
	}
}

func TestFormatWindowsSystemVersionFallsBackToBuild(t *testing.T) {
	got := formatWindowsSystemVersion(&windowsOSDetail{
		ProductName:   "Windows Server 2019 Standard",
		CurrentBuild:  "17763",
		BuildRevision: "17763.6293",
	})
	if got != "Windows Server 2019 Standard (Build 17763.6293)" {
		t.Fatalf("系统版本未保留 Build: %q", got)
	}
}

func TestCollectCapabilityReportsIncludesWindowsOSFacts(t *testing.T) {
	reports := collectCapabilityReports(runtimeIdentity{
		WindowsVersion: "Windows Server 2022 Datacenter (Build 20348.2402)",
		WindowsOSDetail: &windowsOSDetail{
			ProductName:   "Windows Server 2022 Datacenter",
			BuildRevision: "20348.2402",
		},
	})
	if len(reports) == 0 {
		t.Fatal("系统能力报告不能为空")
	}
	detail, ok := reports[0].Value.(map[string]any)
	if !ok {
		t.Fatalf("系统能力报告格式错误: %#v", reports[0].Value)
	}
	if detail["ProductName"] != "Windows Server 2022 Datacenter" || detail["BuildRevision"] != "20348.2402" {
		t.Fatalf("系统版本原始事实未进入能力报告: %#v", detail)
	}
}
