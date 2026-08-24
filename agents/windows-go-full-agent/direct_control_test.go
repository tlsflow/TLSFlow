package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDirectControlRoutesExecuteAllAgentV2Actions(t *testing.T) {
	store := newDirectControlActionStore()
	defer store.close()
	mux := http.NewServeMux()
	registerDirectControlActionRoutes(mux, store, func(ctx context.Context, request map[string]any, agentID string) (bool, string, string, map[string]any) {
		return executeAgentV2(ctx, request, agentID)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	for _, action := range []string{agentFactCollect, agentPlanValidate, agentPlanExecute, agentExecutionReceipt} {
		body, err := json.Marshal(map[string]any{"action": action})
		if err != nil {
			t.Fatal(err)
		}
		response, err := server.Client().Post(server.URL+"/api/v1/control/actions/start", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		var started map[string]any
		if err := json.NewDecoder(response.Body).Decode(&started); err != nil {
			response.Body.Close()
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusAccepted {
			t.Fatalf("action %s start status=%d body=%v", action, response.StatusCode, started)
		}
		actionID, ok := started["actionId"].(string)
		if !ok || actionID == "" {
			t.Fatalf("action %s did not return actionId: %v", action, started)
		}

		var completed map[string]any
		for attempt := 0; attempt < 20; attempt++ {
			statusResponse, statusErr := server.Client().Get(server.URL + "/api/v1/control/actions/status?actionId=" + actionID)
			if statusErr != nil {
				t.Fatal(statusErr)
			}
			completed = map[string]any{}
			statusErr = json.NewDecoder(statusResponse.Body).Decode(&completed)
			statusResponse.Body.Close()
			if statusErr != nil {
				t.Fatal(statusErr)
			}
			if completed["status"] == directControlActionCompleted {
				break
			}
			time.Sleep(5 * time.Millisecond)
		}
		if completed["status"] != directControlActionCompleted {
			t.Fatalf("action %s did not complete: %v", action, completed)
		}
		if completed["errorCode"] != "AGENT_V2_AUTHORIZATION_DENIED" {
			t.Fatalf("action %s did not reach the v2 executor: %v", action, completed)
		}
	}
}
