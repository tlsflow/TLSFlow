package main

import (
	"errors"
	"fmt"
	"os"
)

// ErrRetired 表示该目录中的历史 CA Node 产品已被永久撤出运行期执行链。
var ErrRetired = errors.New("gcac-ca-node 已废弃：证书签发必须通过 Plugin Runner/Host API 或通用 Agent v2 合同完成")

// run 只负责返回稳定的失败原因，便于启动入口和测试共用同一条失败路径。
func run() error {
	return ErrRetired
}

func main() {
	if err := run(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(78)
	}
}
