package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Config struct {
	BaseURL  string
	TenantID string
}

type APIError struct {
	Message   string `json:"message"`
	ErrorCode string `json:"errorCode"`
}

type Client struct {
	httpClient *http.Client
	config     Config
	requestID  func() string
}

func New(httpClient *http.Client, config Config) *Client {
	return &Client{
		httpClient: httpClient,
		config:     config,
		requestID:  func() string { return fmt.Sprintf("linux_agent_%d", time.Now().UnixNano()) },
	}
}

func (client *Client) DoJSON(ctx context.Context, method string, endpointPath string, payload any, target any) error {
	baseURL := strings.TrimRight(strings.TrimSpace(client.config.BaseURL), "/")
	if baseURL == "" {
		return errors.New("controlPlaneUrl 不能为空")
	}
	body, err := encodePayload(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, method, baseURL+endpointPath, body)
	if err != nil {
		return fmt.Errorf("创建请求失败: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Request-Id", client.requestID())
	if tenantID := strings.TrimSpace(client.config.TenantID); tenantID != "" {
		request.Header.Set("X-Tenant-Id", tenantID)
	}
	response, err := client.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("请求服务端失败: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return fmt.Errorf("读取响应失败: %w", err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return decodeAPIError(response.StatusCode, responseBody)
	}
	return decodeTarget(responseBody, target)
}

func encodePayload(payload any) (io.Reader, error) {
	if payload == nil {
		return nil, nil
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("编码请求失败: %w", err)
	}
	return bytes.NewReader(encoded), nil
}

func decodeAPIError(statusCode int, responseBody []byte) error {
	var apiErr APIError
	if err := json.Unmarshal(responseBody, &apiErr); err == nil && strings.TrimSpace(apiErr.Message) != "" {
		if strings.TrimSpace(apiErr.ErrorCode) != "" {
			return fmt.Errorf("%s (%s)", apiErr.Message, apiErr.ErrorCode)
		}
		return errors.New(apiErr.Message)
	}
	return fmt.Errorf("HTTP %d: %s", statusCode, strings.TrimSpace(string(responseBody)))
}

func decodeTarget(responseBody []byte, target any) error {
	if target == nil || len(bytes.TrimSpace(responseBody)) == 0 {
		return nil
	}
	var wrapped struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(responseBody, &wrapped); err == nil && len(wrapped.Data) > 0 {
		if err := json.Unmarshal(wrapped.Data, target); err == nil {
			return nil
		}
	}
	if err := json.Unmarshal(responseBody, target); err == nil {
		return nil
	}
	return fmt.Errorf("解析响应失败: %s", strings.TrimSpace(string(responseBody)))
}
