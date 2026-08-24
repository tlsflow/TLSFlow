package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

type discoveryRequest struct {
	Operation string `json:"operation"`
}

type discoveryResponse struct {
	Success   bool           `json:"success"`
	Operation string         `json:"operation"`
	Inventory map[string]any `json:"inventory,omitempty"`
	Error     string         `json:"error,omitempty"`
}

func main() {
	decoder := json.NewDecoder(bufio.NewReader(os.Stdin))
	encoder := json.NewEncoder(os.Stdout)
	for {
		var request discoveryRequest
		if err := decoder.Decode(&request); err != nil {
			if err == io.EOF {
				return
			}
			_ = encoder.Encode(discoveryResponse{Success: false, Error: "请求 JSON 无效"})
			return
		}
		if request.Operation != "discover" {
			_ = encoder.Encode(discoveryResponse{Success: false, Operation: request.Operation, Error: "Agent-side Operation 未登记"})
			continue
		}
		inventory := collectWindowsMatureWebInventory(context.Background(), nil)
		if inventory == nil {
			_ = encoder.Encode(discoveryResponse{Success: false, Operation: request.Operation, Error: "发现器未返回快照"})
			continue
		}
		if err := encoder.Encode(discoveryResponse{Success: true, Operation: request.Operation, Inventory: inventory}); err != nil {
			fmt.Fprintln(os.Stderr, "Agent-side 结果写入失败:", err)
			return
		}
	}
}
