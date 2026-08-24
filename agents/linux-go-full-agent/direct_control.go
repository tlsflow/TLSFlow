package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	directControlMaxRequestBytes = 1 << 20
	directControlMaxActions      = 256
	directControlActionQueued    = "queued"
	directControlActionRunning   = "running"
	directControlActionCompleted = "completed"
)

type directControlActionExecutor func(context.Context, map[string]any, string) (bool, string, string, map[string]any)

type directControlAction struct {
	ID           string
	ActionType   string
	RequestID    string
	Status       string
	Success      bool
	ErrorCode    string
	ErrorMessage string
	Detail       map[string]any
	Outcome      string
	CreatedAt    time.Time
	StartedAt    time.Time
	CompletedAt  time.Time
}

type directControlActionStore struct {
	mu       sync.RWMutex
	actions  map[string]*directControlAction
	ctx      context.Context
	cancel   context.CancelFunc
	sequence uint64
}

func newDirectControlActionStore() *directControlActionStore {
	ctx, cancel := context.WithCancel(context.Background())
	return &directControlActionStore{
		actions: make(map[string]*directControlAction),
		ctx:     ctx,
		cancel:  cancel,
	}
}

func (s *directControlActionStore) start(actionType, requestID string, request map[string]any, execute directControlActionExecutor) (string, error) {
	if s == nil || execute == nil {
		return "", errors.New("direct control action store is unavailable")
	}
	now := time.Now()
	actionID := fmt.Sprintf("agent-v2-%d-%d", now.UnixNano(), atomic.AddUint64(&s.sequence, 1))
	action := &directControlAction{
		ID:         actionID,
		ActionType: actionType,
		RequestID:  requestID,
		Status:     directControlActionQueued,
		CreatedAt:  now,
	}
	s.mu.Lock()
	if len(s.actions) >= directControlMaxActions && !s.pruneCompletedLocked() {
		s.mu.Unlock()
		return "", errors.New("direct control action capacity is exhausted")
	}
	s.actions[actionID] = action
	s.mu.Unlock()

	go func() {
		s.mu.Lock()
		if current, ok := s.actions[actionID]; ok {
			current.Status = directControlActionRunning
			current.StartedAt = time.Now()
		}
		s.mu.Unlock()

		s.mu.RLock()
		ctx := s.ctx
		if ctx == nil {
			s.mu.RUnlock()
			return
		}
		s.mu.RUnlock()

		success, errorCode, errorMessage, detail := execute(ctx, request, agentIDFromRequest(request))
		outcome := directControlOutcome(success, errorCode)
		s.mu.Lock()
		if current, ok := s.actions[actionID]; ok {
			current.Status = directControlActionCompleted
			current.Success = success
			current.ErrorCode = errorCode
			current.ErrorMessage = errorMessage
			current.Detail = detail
			current.Outcome = outcome
			current.CompletedAt = time.Now()
		}
		s.mu.Unlock()
	}()
	return actionID, nil
}

func (s *directControlActionStore) get(actionID string) (directControlAction, bool) {
	s.mu.RLock()
	action, ok := s.actions[actionID]
	if !ok {
		s.mu.RUnlock()
		return directControlAction{}, false
	}
	copyAction := *action
	if action.Detail != nil {
		copyAction.Detail = cloneMap(action.Detail)
	}
	s.mu.RUnlock()
	return copyAction, true
}

func (s *directControlActionStore) close() {
	if s == nil {
		return
	}
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.ctx = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (s *directControlActionStore) pruneCompletedLocked() bool {
	var oldestID string
	var oldest time.Time
	for actionID, action := range s.actions {
		if action.Status != directControlActionCompleted {
			continue
		}
		if oldestID == "" || action.CreatedAt.Before(oldest) {
			oldestID = actionID
			oldest = action.CreatedAt
		}
	}
	if oldestID == "" {
		return false
	}
	delete(s.actions, oldestID)
	return true
}

func registerDirectControlActionRoutes(mux *http.ServeMux, store *directControlActionStore, execute directControlActionExecutor) {
	mux.HandleFunc("/api/v1/control/actions/start", func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			writeDirectControlJSON(writer, http.StatusMethodNotAllowed, map[string]any{"errorCode": "METHOD_NOT_ALLOWED", "message": "只允许 POST"})
			return
		}
		payload, err := decodeDirectControlRequest(writer, request)
		if err != nil {
			writeDirectControlJSON(writer, http.StatusBadRequest, map[string]any{"errorCode": "AGENT_V2_MESSAGE_INVALID", "message": err.Error()})
			return
		}
		actionType, ok := payload["action"].(string)
		actionType = strings.TrimSpace(actionType)
		if !ok || !isAgentV2Action(actionType) {
			writeDirectControlJSON(writer, http.StatusBadRequest, map[string]any{"errorCode": "AGENT_V2_ACTION_UNSUPPORTED", "message": "action 不在 Agent v2 四动作合同内"})
			return
		}
		requestID, _ := payload["requestId"].(string)
		actionID, err := store.start(actionType, strings.TrimSpace(requestID), payload, execute)
		if err != nil {
			writeDirectControlJSON(writer, http.StatusServiceUnavailable, map[string]any{"errorCode": "DIRECT_CONTROL_CAPACITY_EXHAUSTED", "message": err.Error()})
			return
		}
		writeDirectControlJSON(writer, http.StatusAccepted, map[string]any{"actionId": actionID, "actionType": actionType, "status": directControlActionQueued})
	})

	mux.HandleFunc("/api/v1/control/actions/status", func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			writeDirectControlJSON(writer, http.StatusMethodNotAllowed, map[string]any{"errorCode": "METHOD_NOT_ALLOWED", "message": "只允许 GET"})
			return
		}
		actionID := strings.TrimSpace(request.URL.Query().Get("actionId"))
		if actionID == "" {
			writeDirectControlJSON(writer, http.StatusBadRequest, map[string]any{"errorCode": "ACTION_ID_REQUIRED", "message": "actionId 不能为空"})
			return
		}
		action, ok := store.get(actionID)
		if !ok {
			writeDirectControlJSON(writer, http.StatusNotFound, map[string]any{"errorCode": "ACTION_NOT_FOUND", "message": "直连 action 不存在"})
			return
		}
		writeDirectControlJSON(writer, http.StatusOK, directControlActionResponse(action))
	})
}

func decodeDirectControlRequest(writer http.ResponseWriter, request *http.Request) (map[string]any, error) {
	request.Body = http.MaxBytesReader(writer, request.Body, directControlMaxRequestBytes)
	decoder := json.NewDecoder(request.Body)
	var payload map[string]any
	if err := decoder.Decode(&payload); err != nil {
		return nil, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return nil, errors.New("不允许提交多个 JSON 值")
		}
		return nil, err
	}
	if payload == nil {
		return nil, errors.New("请求载荷不能为空")
	}
	return payload, nil
}

func directControlActionResponse(action directControlAction) map[string]any {
	response := map[string]any{
		"actionId":   action.ID,
		"actionType": action.ActionType,
		"requestId":  action.RequestID,
		"status":     action.Status,
		"createdAt":  action.CreatedAt.Format(time.RFC3339Nano),
	}
	if !action.StartedAt.IsZero() {
		response["startedAt"] = action.StartedAt.Format(time.RFC3339Nano)
	}
	if action.Status != directControlActionCompleted {
		response["detail"] = map[string]any{"status": action.Status}
		return response
	}
	response["success"] = action.Success
	response["outcome"] = action.Outcome
	response["completedAt"] = action.CompletedAt.Format(time.RFC3339Nano)
	if action.ErrorCode != "" {
		response["errorCode"] = action.ErrorCode
	}
	if action.ErrorMessage != "" {
		response["errorMessage"] = action.ErrorMessage
	}
	if action.Detail != nil {
		response["detail"] = action.Detail
	}
	return response
}

func directControlOutcome(success bool, errorCode string) string {
	if success {
		return "SUCCESS"
	}
	if errorCode == "AGENT_EXECUTION_UNKNOWN" {
		return "UNKNOWN"
	}
	return "FAILED"
}

func writeDirectControlJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}

func isAgentV2Action(action string) bool {
	switch action {
	case agentFactCollect, agentPlanValidate, agentPlanExecute, agentExecutionReceipt:
		return true
	default:
		return false
	}
}

func agentIDFromRequest(request map[string]any) string {
	value, _ := request["agentId"].(string)
	return strings.TrimSpace(value)
}
