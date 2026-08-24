package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
)

const version = "0.4.0"

type config struct {
	ControlPlaneURL string `json:"controlPlaneUrl"`
	TenantID        string `json:"tenantId"`
	ProviderID      string `json:"providerId"`
	EnrollmentToken string `json:"enrollmentToken,omitempty"`
	NodeID          string `json:"nodeId,omitempty"`
	NodeName        string `json:"nodeName"`
	DataDir         string `json:"dataDir"`
	CAConfig        string `json:"caConfig,omitempty"`
	DefaultTemplate string `json:"defaultTemplate,omitempty"`
}

type agent struct {
	configPath   string
	config       config
	client       *http.Client
	streamClient *http.Client
	mu           sync.Mutex
	privateKey   ed25519.PrivateKey
	publicKeyPEM string
}

type serviceHandler struct{ agent *agent }

func main() {
	if len(os.Args) < 2 {
		fatal(errors.New("用法：gcac-adcs-agent <preflight|run|service run> --config <path>"))
	}
	command := os.Args[1]
	if command == "service" && len(os.Args) > 2 && os.Args[2] == "run" {
		runService(os.Args[3:])
		return
	}
	flags := flag.NewFlagSet(command, flag.ExitOnError)
	configPath := flags.String("config", "agent.config.json", "配置文件路径")
	_ = flags.Parse(os.Args[2:])
	instance, err := newAgent(*configPath)
	if err != nil {
		fatal(err)
	}
	switch command {
	case "preflight":
		result, err := instance.discover(context.Background())
		if err != nil {
			fatal(err)
		}
		writeStdout(result)
	case "run":
		fatal(instance.run(context.Background()))
	default:
		fatal(fmt.Errorf("不支持的命令：%s", command))
	}
}

func runService(args []string) {
	flags := flag.NewFlagSet("service run", flag.ExitOnError)
	configPath := flags.String("config", "agent.config.json", "配置文件路径")
	_ = flags.Parse(args)
	instance, err := newAgent(*configPath)
	if err != nil {
		fatal(err)
	}
	logFile, err := openAgentLog(instance.config.DataDir)
	if err != nil {
		fatal(err)
	}
	defer logFile.Close()
	log.SetOutput(io.MultiWriter(os.Stderr, logFile))
	if err := svc.Run("gcac-adcs-agent", &serviceHandler{agent: instance}); err != nil {
		fatal(err)
	}
}

func (handler *serviceHandler) Execute(_ []string, requests <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	status <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- handler.agent.run(ctx) }()
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for {
		select {
		case request := <-requests:
			switch request.Cmd {
			case svc.Interrogate:
				status <- request.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				cancel()
				<-done
				return false, 0
			}
		case err := <-done:
			if err != nil {
				log.Printf("AD CS Agent 退出：%v", err)
				return true, 1
			}
			return false, 0
		}
	}
}

func newAgent(configPath string) (*agent, error) {
	content, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}
	var cfg config
	if err := json.Unmarshal(content, &cfg); err != nil {
		return nil, err
	}
	if cfg.ControlPlaneURL == "" || cfg.TenantID == "" || cfg.ProviderID == "" {
		return nil, errors.New("controlPlaneUrl、tenantId 和 providerId 必填")
	}
	if cfg.NodeName == "" {
		cfg.NodeName, _ = os.Hostname()
	}
	if cfg.DataDir == "" {
		cfg.DataDir = filepath.Dir(configPath)
	}
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		return nil, err
	}
	privateKey, publicKeyPEM, err := loadOrCreateIdentityKey(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	return &agent{
		configPath: configPath, config: cfg,
		client: &http.Client{Timeout: 45 * time.Second}, streamClient: &http.Client{},
		privateKey: privateKey, publicKeyPEM: publicKeyPEM,
	}, nil
}

func (a *agent) run(ctx context.Context) error {
	discovery, err := a.discover(ctx)
	if err != nil {
		return err
	}
	if a.config.CAConfig == "" {
		a.config.CAConfig = fmt.Sprint(discovery["caConfig"])
	}
	reconnectDelay := time.Second
	for {
		if a.config.NodeID == "" {
			err = a.register(discovery)
		} else {
			err = a.reportDiscovery(discovery)
		}
		if err == nil {
			err = a.leasePendingTask(ctx)
		}
		if err == nil {
			err = a.streamTasks(ctx)
		}
		if ctx.Err() != nil {
			return nil
		}
		log.Printf("控制面连接失败，将在 %s 后重试：%v", reconnectDelay, err)
		timer := time.NewTimer(reconnectDelay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
		if reconnectDelay < 30*time.Second {
			reconnectDelay *= 2
		}
	}
}

func (a *agent) leasePendingTask(ctx context.Context) error {
	var task map[string]any
	if err := a.post(ctx, "/api/v1/ca-nodes/tasks/lease", map[string]any{"nodeId": a.config.NodeID}, &task); err != nil {
		return err
	}
	if len(task) == 0 || strings.TrimSpace(fmt.Sprint(task["id"])) == "" {
		return nil
	}
	return a.executeTask(ctx, task)
}

func openAgentLog(dataDir string) (*os.File, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}
	return os.OpenFile(filepath.Join(dataDir, "gcac-adcs-agent.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
}

func (a *agent) discover(ctx context.Context) (map[string]any, error) {
	if _, err := exec.LookPath("certutil.exe"); err != nil {
		return nil, errors.New("未找到 certutil.exe")
	}
	active, err := runCommand(ctx, 20*time.Second, "reg.exe", "query", `HKLM\SYSTEM\CurrentControlSet\Services\CertSvc\Configuration`, "/v", "Active")
	if err != nil {
		return nil, errors.New("未发现本机 AD CS Certification Authority，请在 CA 服务器上安装 Agent")
	}
	caName := parseRegistryValue(active, "Active")
	if caName == "" {
		return nil, errors.New("无法读取活动 CA 名称")
	}
	hostname, _ := os.Hostname()
	caConfig := hostname + `\` + caName
	caInfo, err := runCommand(ctx, 30*time.Second, "certutil.exe", "-config", caConfig, "-cainfo")
	if err != nil {
		return nil, fmt.Errorf("无法访问 CA %s：%w", caConfig, err)
	}
	templatesOutput, templatesErr := runCommand(ctx, 30*time.Second, "certutil.exe", "-config", caConfig, "-CATemplates")
	if templatesErr != nil {
		return nil, fmt.Errorf("无法读取已发布模板：%w", templatesErr)
	}
	return map[string]any{
		"status": "ready", "caConfig": caConfig, "caName": caName, "computerName": hostname,
		"caInfo": caInfo, "templates": parseTemplateNames(templatesOutput), "templatesRaw": templatesOutput,
		"capabilities": capabilities(), "version": version,
	}, nil
}

func (a *agent) register(discovery map[string]any) error {
	if a.config.EnrollmentToken == "" {
		return errors.New("缺少一次性注册令牌")
	}
	publicKeyDER, err := x509.MarshalPKIXPublicKey(a.privateKey.Public())
	if err != nil {
		return err
	}
	identity := sha256.Sum256(publicKeyDER)
	payload := map[string]any{
		"token": a.config.EnrollmentToken, "name": a.config.NodeName, "platform": "windows", "role": "member",
		"identityFingerprint": hex.EncodeToString(identity[:]), "keyBackend": "file", "exportability": "exportable",
		"authenticationPublicKeyPem": a.publicKeyPEM, "capabilities": capabilities(), "version": version,
		"discovery": discovery,
	}
	var response struct {
		ID string `json:"id"`
	}
	if err := a.post(ctxBackground(), "/api/v1/ca-nodes/register", payload, &response); err != nil {
		return err
	}
	if response.ID == "" {
		return errors.New("控制面未返回节点 ID")
	}
	a.config.NodeID = response.ID
	a.config.EnrollmentToken = ""
	return a.saveConfig()
}

func (a *agent) reportDiscovery(discovery map[string]any) error {
	payload := map[string]any{
		"nodeId": a.config.NodeID, "healthStatus": "online", "capabilities": capabilities(),
		"version": version, "discovery": discovery,
	}
	return a.post(ctxBackground(), "/api/v1/ca-nodes/heartbeat", payload, nil)
}

func (a *agent) streamTasks(ctx context.Context) error {
	const path = "/api/v1/ca-nodes/tasks/stream"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(a.config.ControlPlaneURL, "/")+path, nil)
	if err != nil {
		return err
	}
	request.Header.Set("accept", "text/event-stream")
	request.Header.Set("cache-control", "no-cache")
	request.Header.Set("x-tenant-id", a.config.TenantID)
	if err := a.signRequest(request, path, []byte("{}")); err != nil {
		return err
	}
	response, err := a.streamClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 64*1024))
		return fmt.Errorf("任务推送通道返回 HTTP %d：%s", response.StatusCode, sanitizeOutput(string(body)))
	}
	return readServerEvents(ctx, response.Body, func(event string, data []byte) error {
		if event != "task" {
			return nil
		}
		var task map[string]any
		if err := json.Unmarshal(data, &task); err != nil {
			return fmt.Errorf("任务推送数据无效：%w", err)
		}
		return a.executeTask(ctx, task)
	})
}

func readServerEvents(ctx context.Context, input io.Reader, handle func(event string, data []byte) error) error {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	event := "message"
	data := make([]byte, 0, 1024)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return nil
		default:
		}
		line := scanner.Text()
		if line == "" {
			if len(data) > 0 {
				if err := handle(event, bytes.TrimSuffix(data, []byte("\n"))); err != nil {
					return err
				}
			}
			event = "message"
			data = data[:0]
			continue
		}
		if strings.HasPrefix(line, "event:") {
			event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			continue
		}
		if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimSpace(strings.TrimPrefix(line, "data:"))...)
			data = append(data, '\n')
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return io.EOF
}

func (a *agent) executeTask(ctx context.Context, task map[string]any) error {
	taskID := fmt.Sprint(task["id"])
	taskType := fmt.Sprint(task["taskType"])
	payload, _ := task["payload"].(map[string]any)
	result, err := a.dispatch(ctx, taskType, payload)
	response := map[string]any{"nodeId": a.config.NodeID, "success": err == nil}
	if err == nil {
		response["result"] = result
	} else {
		response["errorCode"] = "ADCS_TASK_FAILED"
		response["errorMessage"] = err.Error()
	}
	return a.post(ctx, "/api/v1/ca-nodes/tasks/"+taskID+"/result", response, &map[string]any{})
}

func (a *agent) dispatch(ctx context.Context, taskType string, payload map[string]any) (map[string]any, error) {
	switch taskType {
	case "health_check", "discover_adcs":
		return a.discover(ctx)
	case "inspect_adcs_view":
		return a.inspectAdcsView(ctx, payload)
	case "sync_adcs_records":
		return a.syncAdcsRecords(ctx, payload)
	case "sign_csr":
		return a.submitCSR(ctx, payload)
	case "query_issuance":
		return a.retrieveRequest(ctx, payload)
	case "revoke_certificate":
		serial, err := payloadString(payload, "serialNumber")
		if err != nil {
			return nil, err
		}
		reason := certutilReason(fmt.Sprint(payload["reason"]))
		output, err := runCommand(ctx, 60*time.Second, "certutil.exe", "-config", a.caConfig(payload), "-revoke", serial, reason)
		return map[string]any{"serialNumber": serial, "revokedAt": time.Now().UTC().Format(time.RFC3339), "output": output}, err
	case "publish_crl":
		output, err := runCommand(ctx, 90*time.Second, "certutil.exe", "-config", a.caConfig(payload), "-crl")
		return map[string]any{"publishedAt": time.Now().UTC().Format(time.RFC3339), "output": output}, err
	default:
		return nil, fmt.Errorf("不支持的 AD CS 任务：%s", taskType)
	}
}

func (a *agent) syncAdcsRecords(ctx context.Context, payload map[string]any) (map[string]any, error) {
	objectType, err := payloadString(payload, "objectType")
	if err != nil {
		return nil, err
	}
	if objectType != "request" && objectType != "issuance" && objectType != "revocation" && objectType != "template" {
		return nil, fmt.Errorf("不支持的 AD CS 同步对象类型：%s", objectType)
	}
	limit := 500
	if value, ok := payload["limit"]; ok {
		limit, err = strconv.Atoi(fmt.Sprint(value))
		if err != nil || limit < 1 || limit > 500 {
			return nil, errors.New("limit 必须是 1 到 500 之间的整数")
		}
	}
	cursor := ""
	if value, ok := payload["cursor"]; ok && value != nil {
		cursor = strings.TrimSpace(fmt.Sprint(value))
		if len(cursor) > 2048 {
			return nil, errors.New("cursor 长度不能超过 2048")
		}
	}
	changedAfter := ""
	if value, ok := payload["changedAfter"]; ok && value != nil {
		changedAfter = strings.TrimSpace(fmt.Sprint(value))
		if changedAfter != "" {
			if _, err := time.Parse(time.RFC3339, changedAfter); err != nil {
				return nil, errors.New("changedAfter 必须是 RFC3339 时间")
			}
		}
	}
	if objectType == "template" {
		return a.syncAdcsTemplates(ctx, limit, cursor)
	}

	columns := map[string][]string{
		"request": {
			"Request.RequestID", "Request.Disposition", "Request.DispositionMessage", "Request.StatusCode",
			"Request.RequesterName", "Request.SubmittedWhen", "Request.ResolvedWhen", "Request.RevokedWhen",
			"Request.RevokedEffectiveWhen", "Request.RevokedReason", "Request.CommonName",
		},
		"issuance": {"RequestID", "CertificateTemplate", "SerialNumber", "NotBefore", "NotAfter", "CommonName"},
		"revocation": {
			"Request.RequestID", "Request.Disposition", "Request.DispositionMessage", "Request.StatusCode",
			"Request.SubmittedWhen", "Request.ResolvedWhen", "Request.RevokedWhen", "Request.RevokedEffectiveWhen",
			"Request.RevokedReason", "Request.CommonName",
		},
	}[objectType]
	output, err := runPowerShellJSON(ctx, 90*time.Second, adcsSyncViewScript(objectType, columns), map[string]string{
		"GCAC_ADCS_CA_CONFIG":     a.caConfig(payload),
		"GCAC_ADCS_COLUMNS":       strings.Join(columns, "|"),
		"GCAC_ADCS_LIMIT":         strconv.Itoa(limit + 1),
		"GCAC_ADCS_CURSOR":        cursor,
		"GCAC_ADCS_CHANGED_AFTER": changedAfter,
	})
	if err != nil {
		return nil, fmt.Errorf("无法同步 AD CS %s 记录：%w", objectType, err)
	}
	rows, ok := output["rows"].([]any)
	if !ok {
		return nil, errors.New("AD CS 同步返回缺少 rows")
	}
	records := make([]any, 0, minInt(len(rows), limit))
	for _, row := range rows {
		values, ok := row.(map[string]any)
		if !ok {
			return nil, errors.New("AD CS 同步返回的行格式无效")
		}
		record, ok := normalizeAdcsRecord(objectType, values)
		if ok {
			records = append(records, record)
		}
		if len(records) == limit {
			break
		}
	}
	complete := len(rows) <= limit
	result := map[string]any{
		"objectType": objectType, "records": records, "complete": complete,
		"sourceWatermark": time.Now().UTC().Format(time.RFC3339Nano),
	}
	if !complete && len(records) > 0 {
		result["nextCursor"] = records[len(records)-1].(map[string]any)["cursor"]
	}
	return result, nil
}

func (a *agent) syncAdcsTemplates(ctx context.Context, limit int, cursor string) (map[string]any, error) {
	output, err := runCommand(ctx, 60*time.Second, "certutil.exe", "-config", a.config.CAConfig, "-CATemplates")
	if err != nil {
		return nil, fmt.Errorf("读取 AD CS 模板失败：%w", err)
	}
	names := parseTemplateNames(output)
	start := 0
	if cursor != "" {
		start, err = strconv.Atoi(cursor)
		if err != nil || start < 0 || start > len(names) {
			return nil, errors.New("模板同步游标无效")
		}
	}
	end := minInt(start+limit+1, len(names))
	records := make([]any, 0, end-start)
	for index, name := range names[start:end] {
		records = append(records, map[string]any{
			"externalObjectId": "template:" + name,
			"normalizedStatus": "unknown",
			"sourceStatus":     name,
			"rawSummary":       map[string]any{"templateName": name},
			"cursor":           strconv.Itoa(start + index + 1),
		})
	}
	complete := len(records) <= limit
	if !complete {
		records = records[:limit]
	}
	result := map[string]any{
		"objectType": "template", "records": records, "complete": complete,
		"sourceWatermark": time.Now().UTC().Format(time.RFC3339Nano),
	}
	if !complete && len(records) > 0 {
		result["nextCursor"] = records[len(records)-1].(map[string]any)["cursor"]
	}
	return result, nil
}

func normalizeAdcsRecord(objectType string, values map[string]any) (map[string]any, bool) {
	requestID := firstText(values, "Request.RequestID", "RequestID")
	if requestID == "" {
		return nil, false
	}
	status := "unknown"
	if objectType == "issuance" {
		status = "issued"
	} else if firstText(values, "Request.RevokedWhen") != "" {
		status = "revoked"
	} else {
		disposition := firstInt(values, "Request.Disposition")
		switch disposition {
		case 9, 10, 11:
			status = "pending"
		case 20:
			status = "issued"
		case 30, 31:
			status = "rejected"
		}
	}
	externalObjectID := objectType + ":" + requestID
	if objectType == "issuance" {
		serial := firstText(values, "SerialNumber")
		externalObjectID += ":" + serial
	}
	rawSummary := make(map[string]any, len(values))
	for key, value := range values {
		rawSummary[key] = value
	}
	record := map[string]any{
		"externalObjectId": externalObjectID, "externalParentId": requestID,
		"normalizedStatus": status, "rawSummary": rawSummary, "cursor": requestID,
	}
	if value := firstText(values, "Request.Disposition"); value != "" {
		record["sourceStatus"] = value
	}
	if value := firstText(values, "CertificateTemplate"); value != "" {
		record["templateExternalId"] = value
	}
	if value := firstText(values, "SerialNumber"); value != "" {
		record["serialNumber"] = value
	}
	if value := firstText(values, "Request.CommonName", "CommonName"); value != "" {
		record["subjectCommonName"] = value
	}
	if value := firstText(values, "Request.RequesterName"); value != "" {
		record["requestedByDisplay"] = value
	}
	if value := firstText(values, "Request.SubmittedWhen"); value != "" {
		record["submittedAt"] = value
	}
	if value := firstText(values, "NotBefore"); value != "" {
		record["notBefore"] = value
	}
	if value := firstText(values, "NotAfter"); value != "" {
		record["notAfter"] = value
	}
	if value := firstText(values, "Request.RevokedWhen"); value != "" {
		record["revokedAt"] = value
	}
	return record, true
}

func adcsSyncViewScript(objectType string, columns []string) string {
	return fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$view = New-Object -ComObject CertificateAuthority.View
$view.OpenConnection($env:GCAC_ADCS_CA_CONFIG)
$columns = $env:GCAC_ADCS_COLUMNS.Split('|')
$selected = @()
foreach ($name in $columns) {
  $index = $view.GetColumnIndex($false, $name)
  if ($index -lt 0) { throw "AD CS 固定列不存在：$name" }
  $selected += [ordered]@{ name = $name; index = [int]$index }
}
$view.SetResultColumnCount($selected.Count)
foreach ($column in $selected) { $view.SetResultColumn([int]$column.index) }
$cursor = $env:GCAC_ADCS_CURSOR
$changedAfter = $env:GCAC_ADCS_CHANGED_AFTER
if ($cursor -ne '') {
  $requestColumnName = $(if ('%s' -eq 'issuance') { 'RequestID' } else { 'Request.RequestID' })
  $requestColumn = $selected | Where-Object { $_.name -eq $requestColumnName } | Select-Object -First 1
  if ($null -eq $requestColumn) { throw 'AD CS 固定查询缺少 Request ID 列' }
  if ($cursor -notmatch '^\d+$') { throw 'AD CS Request ID 游标无效' }
  $view.SetRestriction([int]$requestColumn.index, 0x10, 0x1, [int]$cursor)
}
$rows = $view.OpenView()
$output = @()
$maxRows = [int]$env:GCAC_ADCS_LIMIT
$rowIndex = $rows.Next()
while ($rowIndex -ne -1 -and $output.Count -lt $maxRows) {
  $values = [ordered]@{}
  $rowColumns = $rows.EnumCertViewColumn()
  $columnIndex = $rowColumns.Next()
  while ($columnIndex -ne -1) {
    $name = $rowColumns.GetName()
    $value = $rowColumns.GetValue(0)
    if ($value -is [byte[]]) { $value = [Convert]::ToBase64String($value) }
    elseif ($value -is [DateTime]) { $value = ([DateTimeOffset]$value).ToUniversalTime().ToString('O') }
    elseif ($null -ne $value -and ([string]$value).Length -gt 512) { $value = ([string]$value).Substring(0, 512) + '[truncated]' }
    $values[$name] = $value
    $columnIndex = $rowColumns.Next()
  }
  $include = $true
  if ($changedAfter -ne '') {
    $changedAt = $null
    foreach ($candidate in @('Request.RevokedWhen', 'Request.ResolvedWhen', 'Request.SubmittedWhen', 'NotBefore')) {
      if ($values.Contains($candidate) -and $null -ne $values[$candidate] -and [string]$values[$candidate] -ne '') {
        try { $candidateDate = [DateTimeOffset]::Parse([string]$values[$candidate]) } catch { continue }
        if ($null -eq $changedAt -or $candidateDate -gt $changedAt) { $changedAt = $candidateDate }
      }
    }
    if ($null -eq $changedAt -or $changedAt -le [DateTimeOffset]::Parse($changedAfter)) { $include = $false }
  }
  if ($include) { $output += $values }
  $rowIndex = $rows.Next()
}
[ordered]@{ rows = $output; objectType = '%s' } | ConvertTo-Json -Depth 8 -Compress`, objectType, objectType)
}

func firstText(values map[string]any, names ...string) string {
	for _, name := range names {
		if value, ok := values[name]; ok && value != nil && strings.TrimSpace(fmt.Sprint(value)) != "" {
			return strings.TrimSpace(fmt.Sprint(value))
		}
	}
	return ""
}

func firstInt(values map[string]any, name string) int {
	value := firstText(values, name)
	parsed, _ := strconv.Atoi(value)
	return parsed
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func (a *agent) inspectAdcsView(ctx context.Context, payload map[string]any) (map[string]any, error) {
	limit := 20
	if value, ok := payload["limit"]; ok {
		parsed, err := strconv.Atoi(fmt.Sprint(value))
		if err != nil || parsed < 1 || parsed > 20 {
			return nil, errors.New("limit 必须是 1 到 20 之间的整数")
		}
		limit = parsed
	}

	script := `$ErrorActionPreference = 'Stop'
$view = New-Object -ComObject CertificateAuthority.View
$view.OpenConnection($env:GCAC_ADCS_CA_CONFIG)
$columnEnumerator = $view.EnumCertViewColumn(0)
$columns = @()
$columnIndex = $columnEnumerator.Next()
while ($columnIndex -ne -1) {
  $columns += [ordered]@{
    index = $columnIndex
    name = $columnEnumerator.GetName()
    type = $columnEnumerator.GetType()
    maxLength = $columnEnumerator.GetMaxLength()
  }
  $columnIndex = $columnEnumerator.Next()
}
$selectedNames = @('RequestID', 'Request.Disposition', 'Request.RequesterName', 'Request.SubmittedWhen', 'CommonName', 'CertificateTemplate', 'SerialNumber', 'NotBefore', 'NotAfter', 'Request.RevokedWhen', 'Request.RevokedReason')
$selected = @()
foreach ($name in $selectedNames) {
  try {
    $index = $view.GetColumnIndex($false, $name)
    if ($index -ge 0) { $selected += [ordered]@{ name = $name; index = $index } }
  } catch {}
}
$rowsOutput = @()
if ($selected.Count -gt 0) {
  $view.SetResultColumnCount($selected.Count)
  foreach ($column in $selected) { $view.SetResultColumn($column.index) }
  $rows = $view.OpenView()
  while ($rowsOutput.Count -lt [int]$env:GCAC_ADCS_LIMIT -and $rows.Next() -ne -1) {
    $values = [ordered]@{}
    $rowColumns = $rows.EnumCertViewColumn()
    while ($rowColumns.Next() -ne -1) {
      $name = $rowColumns.GetName()
      $value = $rowColumns.GetValue(0)
      if ($value -is [byte[]]) { $value = [Convert]::ToBase64String($value) }
      elseif ($value -is [DateTime]) { $value = ([DateTimeOffset]$value).ToUniversalTime().ToString('O') }
      $values[$name] = $value
    }
    $rowsOutput += $values
  }
}
[ordered]@{
  caConfig = $env:GCAC_ADCS_CA_CONFIG
  collectedAt = [DateTimeOffset]::UtcNow.ToString('O')
  uiCulture = [Globalization.CultureInfo]::CurrentUICulture.Name
  columnCount = $columns.Count
  columns = $columns
  selectedColumns = $selected
  sampleRows = $rowsOutput
} | ConvertTo-Json -Depth 8 -Compress`

	output, err := runPowerShellJSON(ctx, 60*time.Second, script, map[string]string{
		"GCAC_ADCS_CA_CONFIG": a.caConfig(payload),
		"GCAC_ADCS_LIMIT":     strconv.Itoa(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("无法读取 AD CS 结构化视图：%w", err)
	}
	return output, nil
}

func runPowerShellJSON(parent context.Context, timeout time.Duration, script string, environment map[string]string) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	command := exec.CommandContext(ctx, "powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script)
	command.Env = os.Environ()
	for key, value := range environment {
		command.Env = append(command.Env, key+"="+value)
	}
	output, err := command.CombinedOutput()
	decoded := decodeCommandOutput(output)
	if ctx.Err() == context.DeadlineExceeded {
		return nil, errors.New("PowerShell 查询超时")
	}
	if err != nil {
		return nil, fmt.Errorf("PowerShell 查询失败：%s", strings.TrimSpace(decoded))
	}
	result := map[string]any{}
	if err := json.Unmarshal([]byte(decoded), &result); err != nil {
		return nil, fmt.Errorf("PowerShell 返回的 JSON 无效：%w", err)
	}
	return result, nil
}

func (a *agent) submitCSR(ctx context.Context, payload map[string]any) (map[string]any, error) {
	csr, err := payloadString(payload, "csrPem")
	if err != nil {
		return nil, err
	}
	template, err := payloadString(payload, "template")
	if err != nil {
		return nil, err
	}
	directory, err := os.MkdirTemp(a.config.DataDir, "request-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(directory)
	csrPath := filepath.Join(directory, "request.req")
	certPath := filepath.Join(directory, "certificate.cer")
	if err := os.WriteFile(csrPath, []byte(csr), 0o600); err != nil {
		return nil, err
	}
	output, commandErr := runCommand(ctx, 90*time.Second, "certreq.exe", "-submit", "-config", a.caConfig(payload), "-attrib", "CertificateTemplate:"+template, csrPath, certPath)
	requestID := parseRequestID(output)
	if commandErr != nil && !strings.Contains(strings.ToLower(output), "pending") {
		return nil, fmt.Errorf("certreq 提交失败：%s", sanitizeOutput(output))
	}
	if _, err := os.Stat(certPath); err == nil {
		certificatePEM, readErr := certificateFileToPEM(ctx, certPath)
		if readErr != nil {
			return nil, readErr
		}
		return map[string]any{"status": "issued", "providerRequestId": requestID, "certificatePem": certificatePEM}, nil
	}
	return map[string]any{"status": "pending", "providerRequestId": requestID, "detail": sanitizeOutput(output)}, nil
}

func (a *agent) retrieveRequest(ctx context.Context, payload map[string]any) (map[string]any, error) {
	requestID, err := payloadString(payload, "providerRequestId")
	if err != nil {
		return nil, err
	}
	directory, err := os.MkdirTemp(a.config.DataDir, "retrieve-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(directory)
	certPath := filepath.Join(directory, "certificate.cer")
	output, commandErr := runCommand(ctx, 60*time.Second, "certreq.exe", "-retrieve", "-config", a.caConfig(payload), requestID, certPath)
	if commandErr != nil {
		lower := strings.ToLower(output)
		if strings.Contains(lower, "denied") {
			return map[string]any{"status": "rejected", "providerRequestId": requestID, "detail": sanitizeOutput(output)}, nil
		}
		return map[string]any{"status": "pending", "providerRequestId": requestID, "detail": sanitizeOutput(output)}, nil
	}
	certificatePEM, err := certificateFileToPEM(ctx, certPath)
	if err != nil {
		return nil, err
	}
	return map[string]any{"status": "issued", "providerRequestId": requestID, "certificatePem": certificatePEM, "detail": sanitizeOutput(output)}, nil
}

func (a *agent) caConfig(payload map[string]any) string {
	if value := strings.TrimSpace(fmt.Sprint(payload["caConfig"])); value != "" && value != "<nil>" {
		return value
	}
	return a.config.CAConfig
}

func (a *agent) post(ctx context.Context, path string, payload any, output any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.config.ControlPlaneURL, "/")+path, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set("x-tenant-id", a.config.TenantID)
	if a.config.NodeID != "" {
		if err := a.signRequest(request, path, encoded); err != nil {
			return err
		}
	}
	response, err := a.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 8*1024*1024))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("控制面返回 HTTP %d：%s", response.StatusCode, sanitizeOutput(string(body)))
	}
	if output != nil && len(body) > 0 {
		return json.Unmarshal(body, output)
	}
	return nil
}

func (a *agent) signRequest(request *http.Request, path string, canonicalBody []byte) error {
	timestamp := time.Now().UTC().Format(time.RFC3339Nano)
	nonceBytes := make([]byte, 24)
	if _, err := rand.Read(nonceBytes); err != nil {
		return err
	}
	nonce := base64.RawURLEncoding.EncodeToString(nonceBytes)
	bodyHash := sha256.Sum256(canonicalBody)
	canonical := strings.Join([]string{request.Method, path, a.config.TenantID, a.config.NodeID, timestamp, nonce, hex.EncodeToString(bodyHash[:])}, "\n")
	signature := ed25519.Sign(a.privateKey, []byte(canonical))
	request.Header.Set("x-gcac-node-id", a.config.NodeID)
	request.Header.Set("x-gcac-timestamp", timestamp)
	request.Header.Set("x-gcac-nonce", nonce)
	request.Header.Set("x-gcac-signature", base64.StdEncoding.EncodeToString(signature))
	return nil
}

func (a *agent) saveConfig() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	content, err := json.MarshalIndent(a.config, "", "  ")
	if err != nil {
		return err
	}
	temporary := a.configPath + ".tmp"
	if err := os.WriteFile(temporary, content, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, a.configPath)
}

func capabilities() map[string]bool {
	return map[string]bool{
		"discoverHierarchy": true, "createRoot": false, "createIntermediate": false, "signCsr": true,
		"queryIssuance": true, "revokeCertificate": true, "publishCrl": true, "ocsp": false,
		"listProfiles": true, "deviceLocalCsr": false, "hardwareBackedKey": true, "highAvailability": false,
	}
}

func runCommand(parent context.Context, timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	command := exec.CommandContext(ctx, name, args...)
	output, err := command.CombinedOutput()
	decoded := decodeCommandOutput(output)
	if ctx.Err() == context.DeadlineExceeded {
		return decoded, fmt.Errorf("命令执行超时：%s", name)
	}
	return decoded, err
}

func decodeCommandOutput(output []byte) string {
	return decodeCommandOutputWithCodePage(output, windows.GetACP())
}

func decodeCommandOutputWithCodePage(output []byte, codePage uint32) string {
	if len(output) == 0 || utf8.Valid(output) || codePage == 0 {
		return string(output)
	}
	wideLength, err := windows.MultiByteToWideChar(codePage, 0, &output[0], int32(len(output)), nil, 0)
	if err != nil || wideLength <= 0 {
		return string(output)
	}
	wide := make([]uint16, wideLength)
	if _, err := windows.MultiByteToWideChar(codePage, 0, &output[0], int32(len(output)), &wide[0], wideLength); err != nil {
		return string(output)
	}
	return string(utf16.Decode(wide))
}

func certificateFileToPEM(ctx context.Context, path string) (string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if bytes.Contains(content, []byte("BEGIN CERTIFICATE")) {
		return string(content), nil
	}
	outputPath := path + ".pem"
	if _, err := runCommand(ctx, 30*time.Second, "certutil.exe", "-encode", path, outputPath); err != nil {
		return "", err
	}
	encoded, err := os.ReadFile(outputPath)
	if err != nil {
		return "", err
	}
	block, _ := pem.Decode(encoded)
	if block == nil {
		return "", errors.New("无法解析签发证书")
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: block.Bytes})), nil
}

func parseRegistryValue(output, name string) string {
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) >= 3 && strings.EqualFold(fields[0], name) {
			return strings.Join(fields[2:], " ")
		}
	}
	return ""
}

func parseTemplateNames(output string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, line := range strings.Split(output, "\n") {
		value := strings.TrimSpace(strings.SplitN(line, "--", 2)[0])
		if value == "" || strings.Contains(value, ":") || strings.Contains(strings.ToLower(value), "certutil") || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func parseRequestID(output string) string {
	for _, line := range strings.Split(output, "\n") {
		lower := strings.ToLower(line)
		if !strings.Contains(lower, "requestid") && !strings.Contains(lower, "request id") {
			continue
		}
		for _, field := range strings.FieldsFunc(line, func(r rune) bool { return r < '0' || r > '9' }) {
			if _, err := strconv.ParseUint(field, 10, 64); err == nil {
				return field
			}
		}
	}
	return ""
}

func payloadString(payload map[string]any, key string) (string, error) {
	value := strings.TrimSpace(fmt.Sprint(payload[key]))
	if value == "" || value == "<nil>" {
		return "", fmt.Errorf("任务缺少字段：%s", key)
	}
	return value, nil
}

func certutilReason(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "keycompromise":
		return "1"
	case "cacompromise":
		return "2"
	case "affiliationchanged":
		return "3"
	case "superseded":
		return "4"
	case "cessationofoperation":
		return "5"
	case "certificatehold":
		return "6"
	default:
		return "0"
	}
}

func sanitizeOutput(value string) string {
	value = strings.ReplaceAll(value, "\x00", "")
	value = strings.TrimSpace(value)
	if len(value) > 4096 {
		return value[:4096]
	}
	return value
}

func ctxBackground() context.Context { return context.Background() }

func writeStdout(value any) {
	encoded, _ := json.MarshalIndent(value, "", "  ")
	fmt.Println(string(encoded))
}

func loadOrCreateIdentityKey(dataDir string) (ed25519.PrivateKey, string, error) {
	path := filepath.Join(dataDir, "node-identity.pem")
	if content, err := os.ReadFile(path); err == nil {
		block, _ := pem.Decode(content)
		if block == nil {
			return nil, "", errors.New("节点身份私钥格式无效")
		}
		parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, "", err
		}
		privateKey, ok := parsed.(ed25519.PrivateKey)
		if !ok {
			return nil, "", errors.New("节点身份私钥类型无效")
		}
		return identityKeyResult(privateKey)
	}
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, "", err
	}
	der, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return nil, "", err
	}
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0o600); err != nil {
		return nil, "", err
	}
	return identityKeyResult(privateKey)
}

func identityKeyResult(privateKey ed25519.PrivateKey) (ed25519.PrivateKey, string, error) {
	der, err := x509.MarshalPKIXPublicKey(privateKey.Public())
	if err != nil {
		return nil, "", err
	}
	return privateKey, string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})), nil
}

func fatal(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
