package main

import (
	"reflect"
	"testing"
)

func TestParseRegistryValue(t *testing.T) {
	output := "    Active    REG_SZ    Contoso Issuing CA\r\n"
	if actual := parseRegistryValue(output, "Active"); actual != "Contoso Issuing CA" {
		t.Fatalf("活动 CA 解析错误：%q", actual)
	}
}

func TestParseTemplateNames(t *testing.T) {
	output := "WebServer -- Web Server\r\nGCACWebServer -- GCAC Web Server\r\nCertUtil: -CATemplates command completed successfully.\r\n"
	expected := []string{"WebServer", "GCACWebServer"}
	if actual := parseTemplateNames(output); !reflect.DeepEqual(actual, expected) {
		t.Fatalf("模板解析错误：%v", actual)
	}
}

func TestParseRequestID(t *testing.T) {
	if actual := parseRequestID("RequestId: 184\r\nCertificate retrieved"); actual != "184" {
		t.Fatalf("Request ID 解析错误：%q", actual)
	}
}

func TestCertutilReason(t *testing.T) {
	if certutilReason("keyCompromise") != "1" || certutilReason("superseded") != "4" || certutilReason("unknown") != "0" {
		t.Fatal("吊销原因映射错误")
	}
}

func TestPayloadStringRejectsMissingField(t *testing.T) {
	if _, err := payloadString(map[string]any{}, "csrPem"); err == nil {
		t.Fatal("缺少任务字段时必须返回错误")
	}
}
