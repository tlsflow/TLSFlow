package compatibility

import "testing"

func TestResolveProductUsesPublicAdapterIDs(t *testing.T) {
	capabilities := map[string]bool{}
	for _, key := range products[0].RequiredCapabilities {
		capabilities[key] = true
	}
	resolution, err := ResolveProduct("", "linux.nginx.deploy_certificate", "pem", capabilities)
	if err != nil {
		t.Fatal(err)
	}
	if resolution.ProductAdapterID != ProductNginx || resolution.StoreAdapterID != StorePOSIXFilesystem {
		t.Fatalf("公共 Adapter ID 解析错误: %#v", resolution)
	}
}

func TestResolveProductFailsClosedOnMissingCapabilities(t *testing.T) {
	if _, err := ResolveProduct(ProductApache, "", "pem", map[string]bool{}); err == nil {
		t.Fatal("能力不足时必须失败关闭")
	}
}
