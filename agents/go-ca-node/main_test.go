package main

import (
	"errors"
	"testing"
)

func TestRunFailsClosedBecauseProductIsRetired(t *testing.T) {
	if !errors.Is(run(), ErrRetired) {
		t.Fatalf("run() 未按废弃产品策略失败关闭")
	}
}
