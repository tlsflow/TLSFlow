package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
	"unicode/utf16"
)

func TestRunCommandTimeoutDoesNotBlock(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 使用 taskkill 终止进程树，由现场构建验证")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	startedAt := time.Now()
	_, err := runCommand(ctx, "sh", "-c", "sleep 2")
	if err == nil {
		t.Fatal("外部命令超时必须返回错误")
	}
	if elapsed := time.Since(startedAt); elapsed > 2*time.Second {
		t.Fatalf("外部命令超时后仍阻塞过久：%s", elapsed)
	}
}

func TestAdcsConfigIsolated(t *testing.T) {
	config := &AgentConfig{SchemaVersion: "gcac.adcs-agent.windows.v1", AgentKey: "adcs.test", ControlPlane: "https://control.invalid", ManagementPort: 18933, Service: struct {
		Name        string `json:"name"`
		DisplayName string `json:"displayName"`
	}{Name: "GCACWindowsAdcsAgent"}}
	if err := validateConfig(config); err != nil {
		t.Fatal(err)
	}
	config.ManagementPort = 18930
	if err := validateConfig(config); err == nil {
		t.Fatal("AD CS Agent 必须拒绝 Full Agent 端口")
	}
}

func TestObservationQueuePersistsAtomicallyAndRetries(t *testing.T) {
	dataDir := t.TempDir()
	state := newObservationState()
	state.Pending = []pendingObservationBatch{{
		Batch:        adcsObservationBatch{AgentID: "agent-1", CaName: "Test-CA", ObservedAt: "2026-08-26T15:00:00Z", Sequence: 1, Records: []map[string]any{{"objectType": "request", "externalObjectId": "request:1"}}},
		Fingerprints: map[string]string{"request|request:1": "fingerprint"},
	}}
	if err := saveObservationState(dataDir, state); err != nil {
		t.Fatal(err)
	}
	loaded, err := loadObservationState(dataDir)
	if err != nil || len(loaded.Pending) != 1 {
		t.Fatalf("失败队列持久化错误：%v %+v", err, loaded)
	}
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts == 1 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"accepted":1,"inserted":1,"updated":0,"duplicates":0,"rejected":0}`))
	}))
	defer server.Close()
	if err := flushObservationQueue(context.Background(), server.Client(), &AgentConfig{ControlPlane: server.URL}, loaded); err == nil {
		t.Fatal("首次失败上报必须返回错误")
	}
	if len(loaded.Pending) != 1 || loaded.Pending[0].AttemptCount != 1 {
		t.Fatalf("首次失败未进入重试队列：%+v", loaded.Pending)
	}
	loaded.Pending[0].NextAttemptAt = ""
	if err := flushObservationQueue(context.Background(), server.Client(), &AgentConfig{ControlPlane: server.URL}, loaded); err != nil {
		t.Fatal(err)
	}
	if len(loaded.Pending) != 0 || loaded.Sent["request|request:1"] != "fingerprint" {
		t.Fatalf("重试成功后队列状态错误：%+v", loaded)
	}
}

func TestObservationQueueKeepsOnlyRejectedRecordsForRetry(t *testing.T) {
	state := newObservationState()
	pending := pendingObservationBatch{
		Batch: adcsObservationBatch{
			AgentID: "agent-1",
			Records: []map[string]any{
				{"objectType": "request", "externalObjectId": "request:1"},
				{"objectType": "request", "externalObjectId": "request:2"},
			},
		},
		Fingerprints: map[string]string{
			"request|request:1": "fingerprint-1",
			"request|request:2": "fingerprint-2",
		},
	}
	result := adcsObservationIngestResult{
		Accepted: 1,
		Rejected: 1,
		Rejections: []struct {
			Index  int    `json:"index"`
			Reason string `json:"reason"`
		}{{Index: 1, Reason: "INVALID_RECORD"}},
	}

	markAcceptedObservationRecords(state, pending, result)
	retry := retainRejectedObservationRecords(pending, result)

	if state.Sent["request|request:1"] != "fingerprint-1" {
		t.Fatalf("已接受记录未标记为 sent：%v", state.Sent)
	}
	if len(retry.Batch.Records) != 1 || stringValue(retry.Batch.Records[0], "externalObjectId") != "request:2" {
		t.Fatalf("重试队列未保留被拒绝记录：%+v", retry)
	}
	if retry.Fingerprints["request|request:2"] != "fingerprint-2" {
		t.Fatalf("被拒绝记录指纹未保留：%v", retry.Fingerprints)
	}
}

func TestObservationStateForcesBackfillWhenAgentIdentityChanges(t *testing.T) {
	state := &persistedObservationState{
		Version: 1,
		Sent:    map[string]string{"request|request:1": "old-fingerprint"},
		Pending: []pendingObservationBatch{{
			Batch: adcsObservationBatch{
				AgentID:  "old-agent",
				CaName:   "Jackson-DC-CA",
				CaConfig: "ADCS-SERVER\\Jackson-DC-CA",
			},
			Fingerprints: map[string]string{"request|request:2": "pending-fingerprint"},
		}},
	}
	config := &AgentConfig{AgentKey: "adcs-agent-key", CaConfig: "ADCS-SERVER\\Jackson-DC-CA"}
	reg := &registration{
		AgentID:  "new-agent",
		CaName:   "Jackson-DC-CA",
		CaConfig: "ADCS-SERVER\\Jackson-DC-CA",
	}

	reconcileObservationState(config, reg, state)

	if state.Version != observationStateVersion {
		t.Fatalf("观测状态版本未升级：%d", state.Version)
	}
	if len(state.Sent) != 0 {
		t.Fatalf("Agent 身份变化后必须清空旧 sent 指纹：%v", state.Sent)
	}
	if len(state.Pending) != 1 || state.Pending[0].Batch.AgentID != "new-agent" {
		t.Fatalf("待发送批次未绑定新 Agent：%+v", state.Pending)
	}
	if state.Source.AgentID != "new-agent" || state.Source.AgentKey != "adcs-agent-key" {
		t.Fatalf("观测来源身份未保存：%+v", state.Source)
	}
}

func TestLegacyObservationStateForcesHistoricalBackfill(t *testing.T) {
	state := &persistedObservationState{
		Version: 1,
		Sent:    map[string]string{"request|request:1": "legacy-fingerprint"},
	}
	config := &AgentConfig{AgentKey: "adcs-agent-key"}
	reg := &registration{AgentID: "agent-1", CaName: "Test-CA"}

	reconcileObservationState(config, reg, state)

	if len(state.Sent) != 0 {
		t.Fatalf("旧版状态文件必须触发历史回填：%v", state.Sent)
	}
	if state.Source.AgentID != "agent-1" || state.Source.CaName != "Test-CA" {
		t.Fatalf("旧版状态迁移后来源身份错误：%+v", state.Source)
	}
}

func TestObservationStateKeepsSentForSameSource(t *testing.T) {
	config := &AgentConfig{AgentKey: "adcs-agent-key", CaConfig: "ADCS-SERVER\\Jackson-DC-CA"}
	reg := &registration{AgentID: "agent-1", CaName: "Jackson-DC-CA", CaConfig: config.CaConfig}
	state := &persistedObservationState{
		Version: observationStateVersion,
		Source: observationSourceIdentity{
			AgentID:       reg.AgentID,
			AgentKey:      config.AgentKey,
			AgentVersion:  agentVersion,
			CaName:        reg.CaName,
			CaConfig:      reg.CaConfig,
			ParserVersion: observationParserVersion,
		},
		Sent: map[string]string{"request|request:1": "fingerprint"},
	}

	reconcileObservationState(config, reg, state)

	if state.Sent["request|request:1"] != "fingerprint" {
		t.Fatalf("同一 Agent/CA 来源不应重复清空 sent 指纹：%v", state.Sent)
	}
}

func TestObservationStateVersionChangeForcesHistoricalBackfill(t *testing.T) {
	config := &AgentConfig{AgentKey: "adcs-agent-key", CaConfig: "ADCS-SERVER\\Jackson-DC-CA"}
	reg := &registration{AgentID: "agent-1", CaName: "Jackson-DC-CA", CaConfig: config.CaConfig}
	state := &persistedObservationState{
		Version: observationStateVersion,
		Source: observationSourceIdentity{
			AgentID:      reg.AgentID,
			AgentKey:     config.AgentKey,
			AgentVersion: "0.1.3",
			CaName:       reg.CaName,
			CaConfig:     reg.CaConfig,
		},
		Sent: map[string]string{"request|request:1": "fingerprint"},
	}

	reconcileObservationState(config, reg, state)

	if len(state.Sent) != 0 {
		t.Fatalf("Agent 二进制版本变化后必须触发历史回填：%v", state.Sent)
	}
	if state.Source.AgentVersion != agentVersion {
		t.Fatalf("观测来源版本未更新：%q", state.Source.AgentVersion)
	}
}

func TestObservationStateVersionUpgradeForcesBackfill(t *testing.T) {
	config := &AgentConfig{AgentKey: "adcs-agent-key", CaConfig: "ADCS-SERVER\\Jackson-DC-CA"}
	reg := &registration{AgentID: "agent-1", CaName: "Jackson-DC-CA", CaConfig: config.CaConfig}
	state := &persistedObservationState{
		Version: 2,
		Source: observationSourceIdentity{
			AgentID:  reg.AgentID,
			AgentKey: config.AgentKey,
			CaName:   reg.CaName,
			CaConfig: reg.CaConfig,
		},
		Sent: map[string]string{"request|request:1": "stale-fingerprint"},
	}

	reconcileObservationState(config, reg, state)

	if state.Version != observationStateVersion || len(state.Sent) != 0 {
		t.Fatalf("状态版本升级后必须触发一次历史回填：version=%d sent=%v", state.Version, state.Sent)
	}
}

func TestRegisterUsesAdcsRoleAndCapabilities(t *testing.T) {
	var request registerRequest
	var tenantHeader, agentTokenHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/agents/register" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		tenantHeader = r.Header.Get("x-tenant-id")
		agentTokenHeader = r.Header.Get("x-agent-token")
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(`{"id":"agent-adcs-1"}`))
	}))
	defer server.Close()
	_, err := registerAgent(context.Background(), server.Client(), &AgentConfig{SchemaVersion: "gcac.adcs-agent.windows.v1", TenantID: "tenant-adcs", AgentKey: "adcs.test", EnrollmentToken: "enrollment-adcs", ControlPlane: server.URL, ManagementPort: 18933, ManagementListenAddress: "127.0.0.1", Service: struct {
		Name        string `json:"name"`
		DisplayName string `json:"displayName"`
	}{Name: "GCACWindowsAdcsAgent"}})
	if err != nil {
		t.Fatal(err)
	}
	if request.Role != "adcs_agent" || request.OSType != "windows_adcs" {
		t.Fatalf("注册身份错误：%+v", request)
	}
	if tenantHeader != "tenant-adcs" || agentTokenHeader != "enrollment-adcs" {
		t.Fatalf("机器请求身份头错误：tenant=%q agent=%q", tenantHeader, agentTokenHeader)
	}
	if !contains(request.Capabilities, "ca.microsoft-adcs.status") || !contains(request.Capabilities, "ca.certificate.issue") || !contains(request.Capabilities, "ca.certificate.revoke") || !contains(request.Capabilities, "ca.crl.publish") {
		t.Fatalf("AD CS 能力缺失：%v", request.Capabilities)
	}
}

func TestParseAdcsViewCsvAndNormalizeStatus(t *testing.T) {
	rows, err := parseAdcsViewCsv("CertUtil: -view\nRequestID,Disposition,Request.CommonName,CertificateTemplate,SerialNumber,NotBefore,NotAfter,Request.SubmittedWhen,RevokedWhen,RequesterName\n1,20 (Issued),issued.example,WebServer,ABC,2026-01-01,2027-01-01,2026-01-01,,CONTOSO\\alice\n2,9 (Pending),pending.example,WebServer,,,,2026-01-02,,CONTOSO\\bob\n3,20,revoked.example,WebServer,DEF,2026-01-03,2027-01-03,2026-01-03,2026-02-01,CONTOSO\\carol\n")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 || rows[0].normalizedStatus != "issued" || rows[1].normalizedStatus != "pending" || rows[2].normalizedStatus != "issued" {
		t.Fatalf("AD CS CSV 状态解析错误：%+v", rows)
	}
	if got := rows[0].observation()["externalObjectId"]; got != "request:1" {
		t.Fatalf("稳定外部对象 ID 错误：%v", got)
	}
}

func TestAdcsListArgsPutConfigBeforeView(t *testing.T) {
	args := adcsListArgs(map[string]any{"objectType": "request", "limit": 100, "cursor": "42"}, "ADCS-SERVER\\Jackson-DC-CA")
	if len(args) < 8 || args[0] != "-config" || args[1] != "ADCS-SERVER\\Jackson-DC-CA" || args[2] != "-restrict" || args[4] != "-out" {
		t.Fatalf("certutil 参数顺序错误：%v", args)
	}
	if !contains(args, "Log") || args[len(args)-1] != "csv" || !strings.Contains(strings.Join(args, " "), "Request.RequestID,Request.Disposition") {
		t.Fatalf("certutil 必须按文档顺序读取历史 Log 且使用原生列名：%v", args)
	}
	fallback := adcsListArgSets(map[string]any{"objectType": "request", "limit": 100}, "")[1]
	if !strings.Contains(strings.Join(fallback, " "), "RequestID,Disposition,RequesterName") {
		t.Fatalf("certutil 必须提供无前缀字段回退：%v", fallback)
	}
	defaultColumns := adcsListArgSets(map[string]any{"objectType": "request", "limit": 100}, "")[2]
	if !contains(defaultColumns, "Log") || !contains(defaultColumns, "csv") || contains(defaultColumns, "-out") {
		t.Fatalf("certutil 必须提供不带 -out 的完整 CSV 回退：%v", defaultColumns)
	}
}

func TestParseAdcsCaConfigOutput(t *testing.T) {
	output := "\nConfig: \"ADCS-SERVER\\Jackson-DC-CA\"\nCertUtil: -getconfig command completed successfully.\n"
	if got := parseCaConfigOutput(output); got != "ADCS-SERVER\\Jackson-DC-CA" {
		t.Fatalf("CA 配置解析错误：%q", got)
	}
}

func TestParseAdcsViewCsvSupportsLocalizedAndPositionalHeaders(t *testing.T) {
	localized, err := parseAdcsViewCsv("提示\n请求 ID,请求处置,请求者姓名,提交时间,解决时间,吊销时间,通用名称,证书模板,序列号,证书生效日期,证书过期日期\n0x2,20 (Issued),CONTOSO\\\\alice,2026-08-01,2026-08-01,,issued.example,WebServer,ABC,2026-08-01,2027-08-01\n")
	if err != nil || len(localized) != 1 || localized[0].requestID != 2 || localized[0].normalizedStatus != "issued" {
		t.Fatalf("本地化 AD CS CSV 解析错误：err=%v rows=%+v", err, localized)
	}

	positional, err := parseAdcsViewCsv("CertUtil: -view Log\n列A,列B,列C,列D,列E,列F,列G,列H,列I,列J,列K\n3,20,CONTOSO\\\\bob,2026-08-02,2026-08-02,,positional.example,WebServer,DEF,2026-08-02,2027-08-02\n")
	if err != nil || len(positional) != 1 || positional[0].requestID != 3 || positional[0].commonName != "positional.example" {
		t.Fatalf("固定列顺序回退解析错误：err=%v rows=%+v", err, positional)
	}

	firstRow, err := parseAdcsViewCsv("1,20,CONTOSO\\\\carol,2026-08-03,2026-08-03,,first-row.example,WebServer,GHI,2026-08-03,2027-08-03\n")
	if err != nil || len(firstRow) != 1 || firstRow[0].requestID != 1 {
		t.Fatalf("无表头且首行就是数据时解析错误：err=%v rows=%+v", err, firstRow)
	}

	utf16Output := encodeUtf16LeWithBom("RequestID,Disposition,RequesterName,SubmittedWhen,ResolvedWhen,RevokedWhen,CommonName,CertificateTemplate,SerialNumber,NotBefore,NotAfter\n4,20,CONTOSO\\\\dave,2026-08-04,2026-08-04,,utf16.example,WebServer,JKL,2026-08-04,2027-08-04\n")
	utf16Rows, err := parseAdcsViewCsv(utf16Output)
	if err != nil || len(utf16Rows) != 1 || utf16Rows[0].requestID != 4 || utf16Rows[0].commonName != "utf16.example" {
		t.Fatalf("UTF-16 AD CS CSV 解析错误：err=%v rows=%+v", err, utf16Rows)
	}

	utf16NoBom := string([]byte{0x52, 0x00, 0x65, 0x00, 0x71, 0x00, 0x75, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00, 0x49, 0x00, 0x44, 0x00, 0x2c, 0x00, 0x44, 0x00, 0x69, 0x00, 0x73, 0x00, 0x70, 0x00, 0x6f, 0x00, 0x73, 0x00, 0x69, 0x00, 0x74, 0x00, 0x69, 0x00, 0x6f, 0x00, 0x6e, 0x00, 0x0a, 0x00, 0x35, 0x00, 0x2c, 0x00, 0x32, 0x00, 0x30, 0x00, 0x0a, 0x00})
	noBomRows, err := parseAdcsViewCsv(utf16NoBom)
	if err != nil || len(noBomRows) != 1 || noBomRows[0].requestID != 5 || noBomRows[0].normalizedStatus != "issued" {
		t.Fatalf("无 BOM UTF-16 AD CS CSV 解析错误：err=%v rows=%+v", err, noBomRows)
	}

	semicolon, err := parseAdcsViewCsv("RequestID;Disposition;RequesterName;SubmittedWhen;ResolvedWhen;RevokedWhen;CommonName;CertificateTemplate;SerialNumber;NotBefore;NotAfter\n6;20;CONTOSO\\\\erin;2026-08-05;2026-08-05;;semicolon.example;WebServer;MNO;2026-08-05;2027-08-05\n")
	if err != nil || len(semicolon) != 1 || semicolon[0].requestID != 6 || semicolon[0].commonName != "semicolon.example" {
		t.Fatalf("分号 AD CS CSV 解析错误：err=%v rows=%+v", err, semicolon)
	}
}

func TestProjectAdcsComRecord(t *testing.T) {
	record, err := projectAdcsComRecord(map[string]any{
		"requestId":     "7",
		"disposition":   "20 (Issued)",
		"requester":     `CONTOSO\alice`,
		"submittedWhen": "2026-08-27T00:00:00Z",
		"resolvedWhen":  "2026-08-27T00:01:00Z",
		"commonName":    "issued.example",
		"template":      "WebServer",
		"serialNumber":  "ABC",
		"notBefore":     "2026-08-27T00:01:00Z",
		"notAfter":      "2027-08-27T00:01:00Z",
	})
	if err != nil {
		t.Fatal(err)
	}
	if record["externalObjectId"] != "request:7" || record["normalizedStatus"] != "issued" || record["serialNumber"] != "ABC" {
		t.Fatalf("COM 记录投影错误：%+v", record)
	}
}

func TestNormalizeAdcsDateAndDisposition(t *testing.T) {
	for _, value := range []string{"", "1601-01-01T00:00:00Z", "1/1/1601 12:00:00 AM", "1899-12-30", "0001-01-01"} {
		if got := normalizeAdcsDate(value); got != "" {
			t.Fatalf("AD CS 默认空日期未清理：%q -> %q", value, got)
		}
		if got := normalizeAdcsDisposition("20 (Issued)", value); got != "issued" {
			t.Fatalf("默认空吊销日期不应覆盖已签发状态：%q -> %q", value, got)
		}
	}
	if got := normalizeAdcsDisposition("20 (Issued)", "2026-08-27T00:00:00Z"); got != "issued" {
		t.Fatalf("已知 Issued 处置不能被吊销日期覆盖：%q", got)
	}
	if got := normalizeAdcsDisposition("20 -- �Ѱ䷢", ""); got != "issued" {
		t.Fatalf("带本地化文本的已颁发处置必须按数字代码识别：%q", got)
	}
	if got := normalizeAdcsDisposition("21 (Revoked)", "2026-08-27T00:00:00Z"); got != "revoked" {
		t.Fatalf("明确 Revoked 处置必须识别为 revoked：%q", got)
	}
}

func TestAdcsComObservationScriptUsesStructuredView(t *testing.T) {
	for _, fragment := range []string{
		"CertificateAuthority.View",
		"OpenConnection($caConfig)",
		"SetResultColumnCount",
		"GCAC_ADCS_VIEW",
		"$view.SetRestriction($(if ($viewName -eq 'Queue') { -1 } else { -2 }), 0, 0, 0)",
		"ConvertTo-Json -Compress",
		"[Convert]::ToBase64String",
		"[Text.Encoding]::UTF8.GetBytes",
	} {
		if !strings.Contains(adcsComObservationScript, fragment) {
			t.Fatalf("COM 采集脚本缺少关键结构：%q", fragment)
		}
	}
}

func TestForcedObservationRescanBypassesLocalDeduplication(t *testing.T) {
	sent := map[string]string{"request|request:1": "same"}
	pending := map[string]struct{}{"request|request:2": {}}
	if shouldQueueObservation(false, sent, pending, "request|request:1", "same") {
		t.Fatal("相同指纹在普通扫描中不应重复入队")
	}
	if shouldQueueObservation(false, sent, pending, "request|request:2", "changed") {
		t.Fatal("已在失败队列中的记录在普通扫描中不应重复入队")
	}
	if !shouldQueueObservation(true, sent, pending, "request|request:1", "same") {
		t.Fatal("强制扫描必须绕过 sent 去重")
	}
	if shouldQueueObservation(true, sent, pending, "request|request:2", "changed") {
		t.Fatal("强制扫描不应重复堆积已有待发送记录")
	}
}

func TestObservationSummaryCountsUniqueRequestsNotDerivedProjections(t *testing.T) {
	records := []map[string]any{
		{"objectType": "request", "normalizedStatus": "issued"},
		{"objectType": "issuance", "normalizedStatus": "issued"},
		{"objectType": "request", "normalizedStatus": "issued"},
		{"objectType": "issuance", "normalizedStatus": "issued"},
	}
	scanned, counts := summarizeAdcsObservationRecords(records)
	if scanned != 2 || counts["request"] != 2 || counts["issuance"] != 2 || counts["revocation"] != 0 {
		t.Fatalf("观测摘要必须按唯一请求统计：scanned=%d counts=%v", scanned, counts)
	}
}

func TestNormalizeAdcsDispositionDoesNotInferRevokedFromDate(t *testing.T) {
	if got := normalizeAdcsDisposition("", "2026-08-27T00:00:00Z"); got != "unknown" {
		t.Fatalf("缺失 Disposition 时不能仅凭日期推断吊销：%q", got)
	}
	if got := normalizeAdcsDisposition("20 -- Issued", "2026-08-27T00:00:00Z"); got != "issued" {
		t.Fatalf("明确已颁发状态不能被日期覆盖：%q", got)
	}
}

func TestAdcsRowsNeedFallbackWhenColumnsAreIncomplete(t *testing.T) {
	if !adcsRowsNeedFallback([]adcsViewRow{{disposition: "20", normalizedStatus: "issued"}}) {
		t.Fatal("RequesterName 全部为空时必须尝试兼容列输出")
	}
	if adcsRowsNeedFallback([]adcsViewRow{{disposition: "20", normalizedStatus: "issued", requester: `CONTOSO\alice`}}) {
		t.Fatal("字段完整时不应重复尝试列集")
	}
	if !adcsRowsNeedFallback([]adcsViewRow{{disposition: "", normalizedStatus: "unknown", requester: `CONTOSO\alice`}}) {
		t.Fatal("Disposition 缺失时必须拒绝可疑列映射")
	}
}

func TestProjectAdcsComRecordPreservesUnicodeAndCleansDefaultDates(t *testing.T) {
	record, err := projectAdcsComRecord(map[string]any{
		"requestId": "8", "disposition": "20 (Issued)",
		"requester": "CONTOSO\\张三", "commonName": "服务器.example.cn",
		"revokedWhen": "1601-01-01T00:00:00Z", "notBefore": "2026-08-27T00:00:00Z",
	})
	if err != nil {
		t.Fatal(err)
	}
	if record["subjectCommonName"] != "服务器.example.cn" || record["requestedByDisplay"] != "CONTOSO\\张三" {
		t.Fatalf("COM Unicode 字段被破坏：%+v", record)
	}
	if record["normalizedStatus"] != "issued" || record["revokedAt"] != "" {
		t.Fatalf("默认吊销日期未清理：%+v", record)
	}
}

func encodeUtf16LeWithBom(value string) string {
	units := utf16.Encode([]rune(value))
	data := make([]byte, 2+len(units)*2)
	data[0], data[1] = 0xff, 0xfe
	for index, unit := range units {
		binary.LittleEndian.PutUint16(data[2+index*2:2+index*2+2], unit)
	}
	return string(data)
}

func TestProviderOperationAliasesAreAccepted(t *testing.T) {
	for _, operation := range []string{"status", "issue", "query", "revoke", "revocation_evidence", "crl.status", "crl.publish"} {
		if operation == "status" {
			if _, err := executeAdcsOperation(context.Background(), operation, map[string]any{}); err == nil || !strings.Contains(err.Error(), "sc.exe") {
				t.Fatalf("status 别名应进入 CertSvc 状态检查：%v", err)
			}
			continue
		}
		if operation == "issue" {
			if _, err := executeAdcsOperation(context.Background(), operation, map[string]any{}); err == nil || !strings.Contains(err.Error(), "csrPem") {
				t.Fatalf("issue 别名应进入 AD CS 签发校验：%v", err)
			}
			continue
		}
		if operation == "query" {
			if _, err := executeAdcsOperation(context.Background(), operation, map[string]any{}); err == nil || !strings.Contains(err.Error(), "providerRequestId") {
				t.Fatalf("query 别名应进入 AD CS 查询校验：%v", err)
			}
			continue
		}
		if operation == "revoke" {
			if _, err := executeAdcsOperation(context.Background(), operation, map[string]any{}); err == nil || !strings.Contains(err.Error(), "serialNumber") {
				t.Fatalf("revoke 别名应进入 AD CS 吊销校验：%v", err)
			}
			continue
		}
		if operation == "revocation_evidence" {
			if _, err := executeAdcsOperation(context.Background(), operation, map[string]any{}); err == nil || !strings.Contains(err.Error(), "certificatePath") {
				t.Fatalf("revocation_evidence 别名应进入证据校验：%v", err)
			}
			continue
		}
		if _, err := executeAdcsOperation(context.Background(), operation, map[string]any{}); err == nil || !strings.Contains(err.Error(), "certutil.exe") {
			t.Fatalf("CRL 别名应进入 certutil 执行路径：%v", err)
		}
	}
}

func TestAdcsPlanRejectsNonAdcsOperation(t *testing.T) {
	plan := validAdcsPlan("filesystem.read", map[string]any{})
	success, code, _, _ := executePlan(context.Background(), map[string]any{"plan": plan}, "agent-adcs")
	if success || code != "ADCS_PLAN_INVALID" {
		t.Fatalf("非 AD CS 操作必须失败：%v %s", success, code)
	}
}

func TestAdcsPlanAcceptsPluginAgentPlanActions(t *testing.T) {
	plan := validAdcsPlan("ca.certificate.issue", map[string]any{})
	success, code, message, detail := executePlan(context.Background(), map[string]any{"agentPlan": plan}, "agent-adcs")
	if success || code != "ADCS_OPERATION_FAILED" || !strings.Contains(message, "csrPem") {
		t.Fatalf("Plugin Agent Plan actions 未转换到 AD CS 执行器：%v %s %s", success, code, message)
	}
	receipt, ok := detail["receipt"].(map[string]any)
	if !ok || receipt["status"] != "FAILED" {
		t.Fatalf("确定性操作失败必须带 FAILED Receipt：%#v", detail)
	}
}

func TestAdcsWriteFailureUsesUnknownReceiptWhenCommandStarted(t *testing.T) {
	err := adcsUnknownOperationError(errors.New("certreq 已启动但连接中断"))
	plan := validAdcsPlan("ca.certificate.issue", map[string]any{"csrPem": "-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----"})
	operations := adcsOperationsFromPlan(plan)
	receipt := buildAgentReceiptWithStatus(map[string]any{"tenantId": "tenant-adcs"}, plan, operations, []any{map[string]any{
		"operationType": "ca.certificate.issue", "status": "UNKNOWN", "error": err.Error(),
	}}, "agent-adcs", "2026-08-25T00:00:00Z", "UNKNOWN", "ADCS_OPERATION_UNKNOWN", "AD CS 写操作已启动但未取得确定结果")
	if receipt["status"] != "UNKNOWN" || receipt["unknownReason"] == "" || receipt["errorCode"] != "ADCS_OPERATION_UNKNOWN" {
		t.Fatalf("未知写操作必须带 UNKNOWN Receipt：%#v", receipt)
	}
}

func TestAdcsReceiptPersistsWithRestrictedPermissions(t *testing.T) {
	dataDir := t.TempDir()
	receipt := map[string]any{"receiptVersion": "gcac.agent-security/v1", "status": "UNKNOWN", "operationResults": []any{}}
	config := &AgentConfig{}
	config.Paths.Windows.DataDir = dataDir
	if err := persistAdcsReceipt(config, "task/unknown:1", receipt); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dataDir, "receipts", "task_unknown_1.json")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("Receipt 文件权限必须为 0600，实际 %o", info.Mode().Perm())
	}
	content, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(content), `"status": "UNKNOWN"`) {
		t.Fatalf("Receipt 文件内容错误：%v %s", err, string(content))
	}
}

func TestAdcsReceiptReplaySkipsPlanExecution(t *testing.T) {
	dataDir := t.TempDir()
	plan := validAdcsPlan("ca.certificate.query", map[string]any{"providerRequestId": "42"})
	receipt := buildAgentReceiptWithStatus(map[string]any{"tenantId": "tenant-adcs"}, plan, adcsOperationsFromPlan(plan), []any{map[string]any{"operationType": "ca.certificate.query", "status": "SUCCESS"}}, "agent-adcs", "2026-08-25T00:00:00Z", "SUCCESS", "", "")
	config := &AgentConfig{}
	config.Paths.Windows.DataDir = dataDir
	if err := persistAdcsReceipt(config, "task-replay", receipt); err != nil {
		t.Fatal(err)
	}
	loaded, err := loadAdcsReceipt(config, "task-replay")
	if err != nil || !receiptMatchesTask(loaded, map[string]any{"plan": plan}) {
		t.Fatalf("已落盘 Receipt 必须能绑定原计划：%v %#v", err, loaded)
	}
	success, code, message, detail := resultFromAdcsReceipt(loaded)
	if !success || code != "" || message != "" || detail["receipt"] == nil {
		t.Fatalf("SUCCESS Receipt 重放结果错误：%v %s %s %#v", success, code, message, detail)
	}
}

func TestAdcsPlanRejectsTamperedDigestAndIdentity(t *testing.T) {
	plan := validAdcsPlan("ca.certificate.query", map[string]any{"providerRequestId": "42"})
	plan["tenantId"] = "other-tenant"
	success, code, _, _ := executePlan(context.Background(), map[string]any{"plan": plan}, "agent-adcs")
	if success || code != "ADCS_PLAN_INVALID" {
		t.Fatalf("租户篡改后的 AD CS 计划必须失败：%v %s", success, code)
	}
}

func validAdcsPlan(operation string, input map[string]any) map[string]any {
	plan := map[string]any{
		"apiVersion": "gcac.agent-plan/v1", "kind": "AgentPlanV1", "pluginId": "ca.microsoft-adcs", "pluginVersionId": "plugin-adcs-1",
		"capability": "ca.certificate.issue", "operation": operation, "agentId": "agent-adcs", "tenantId": "tenant-adcs",
		"executionId": "execution-adcs", "executionStepId": "step-adcs", "tokenId": "token-adcs", "decisionId": "decision-adcs",
		"nonce": "nonce-adcs", "receiptRef": "receipt-adcs", "localPolicyRef": "policy-adcs", "actions": []any{adcsPlanAction(operation, input)},
	}
	plan["planDigest"] = "sha256:" + sha256JSON(plan)
	return plan
}

func adcsPlanAction(operation string, input map[string]any) map[string]any {
	action := map[string]any{"kind": "certificate.authority.operation", "operation": operation}
	for key, value := range input {
		action[key] = value
	}
	return action
}

func TestAdcsReceiptUsesAgentV2ContractFields(t *testing.T) {
	plan := map[string]any{
		"planId":     "plan-adcs",
		"planDigest": "sha256:" + strings.Repeat("a", 64),
		"tenantId":   "tenant-adcs",
		"tokenId":    "token-adcs",
	}
	operations := []map[string]any{{"operationId": "operation-adcs"}}
	receipt := buildAgentReceipt(map[string]any{}, plan, operations, []any{map[string]any{"status": "success"}}, "agent-adcs", "2026-08-25T00:00:00Z")
	if receipt["receiptVersion"] != "gcac.agent-security/v1" || receipt["operationId"] != "operation-adcs" || receipt["status"] != "SUCCESS" {
		t.Fatalf("Receipt 字段不符合 Agent v2 合同：%v", receipt)
	}
	if digest, ok := receipt["digest"].(string); !ok || len(digest) != 64 {
		t.Fatalf("Receipt 摘要缺失：%v", receipt)
	}
}

func TestAdcsReceiptDigestExcludesDigestField(t *testing.T) {
	plan := map[string]any{
		"planId":     "plan-adcs",
		"planDigest": strings.Repeat("b", 64),
		"tenantId":   "tenant-adcs",
		"tokenId":    "token-adcs",
	}
	receipt := buildAgentReceipt(map[string]any{}, plan, []map[string]any{{"operationId": "operation-adcs"}}, []any{map[string]any{"status": "success"}}, "agent-adcs", "2026-08-25T00:00:00Z")
	digest := receipt["digest"].(string)
	delete(receipt, "digest")
	if digest != sha256JSON(receipt) {
		t.Fatalf("Receipt 摘要不得包含自身 digest 字段")
	}
}

func TestAdcsScriptsAndTemplateStayIsolated(t *testing.T) {
	root := "."
	for _, name := range []string{"install-service.ps1", "uninstall-service.ps1", "service-control.ps1", filepath.Join("config", "agent.config.template.json")} {
		if _, err := os.Stat(filepath.Join(root, name)); err != nil {
			t.Fatalf("缺少独立制品：%s", name)
		}
	}
	for _, forbidden := range []string{"windows-go-full-agent", "GCACWindowsCompatibilityAgent", "FullAgentGo", "WindowsCompatibilityAgent", "18930", "18932"} {
		for _, name := range []string{"install-service.ps1", "uninstall-service.ps1", "service-control.ps1"} {
			data, err := os.ReadFile(filepath.Join(root, name))
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(data), forbidden) {
				t.Fatalf("脚本包含其它 Agent 内容 %s: %s", forbidden, name)
			}
		}
	}
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
