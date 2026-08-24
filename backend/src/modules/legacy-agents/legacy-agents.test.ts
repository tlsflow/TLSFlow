import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LegacyCapabilityGate } from './legacy-capability-gate.js';
import { LegacyTaskDispatcher } from './legacy-task-dispatcher.js';
import { LegacyTaskTranslator } from './legacy-task-translator.js';
import type { LegacyAgentProfile, ScriptPackagePlan, UnifiedLegacyStep } from './legacy-agent.types.js';
import { ScriptPackageService } from './script-package.service.js';

function profile(overrides: Partial<LegacyAgentProfile> = {}): LegacyAgentProfile {
  return {
    agentId: 'agent_legacy_001',
    tenantId: 'tenant_001',
    hostId: 'host_001',
    runtimeKind: 'native_static',
    osFamily: 'windows',
    osVersionText: 'Windows Server 2003',
    arch: 'x86',
    protocolMode: 'https_polling',
    supportsAutoUpgrade: false,
    compatibilityLevel: 'L2',
    riskLabels: ['legacy_windows', 'weak_tls'],
    lastCapabilityReportId: 'cap_report_001',
    capabilities: [
      { key: 'agent.legacy.online', value: true },
      { key: 'file.write', value: true },
      { key: 'process.exec', value: true },
      { key: 'backup.create', value: true },
      { key: 'backup.restore', value: true },
      { key: 'verify.basic', value: true },
    ],
    ...overrides,
  };
}

function step(overrides: Partial<UnifiedLegacyStep> = {}): UnifiedLegacyStep {
  return {
    taskId: 'legacy_task_001',
    executionId: 'exec_001',
    stepId: 'step_001',
    tenantId: 'tenant_001',
    planId: 'plan_001',
    targetId: 'host_001',
    idempotencyKey: 'idem_legacy_001',
    risk: 'medium',
    requiredCapabilities: ['file.write', 'process.exec'],
    certificateRef: 'secret://certificates/cert_001',
    certificateFingerprint: 'SHA256:ABCDEF',
    certificateFormat: 'pem',
    targetPaths: { cert: '/etc/ssl/example.crt', key: '/etc/ssl/example.key' },
    installCommand: 'install certificate material',
    verifyCommand: 'verify certificate fingerprint',
    rollbackCommand: 'restore certificate backup',
    expectedVerification: { fingerprint: 'SHA256:ABCDEF', domain: 'legacy.example.com' },
    backupPolicy: { required: true, backupRefHint: '/var/backups/gcac', retentionDays: 7 },
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('spec013 Legacy Agent 与脚本包模式', () => {
  it('profile 只记录 OS 风险，不把 Windows Server 2003 提升成现代兼容等级', () => {
    const legacy = profile();

    assert.equal(legacy.compatibilityLevel, 'L2');
    assert.equal(legacy.osVersionText, 'Windows Server 2003');
    assert.equal(legacy.supportsAutoUpgrade, false);
    assert.deepEqual(legacy.riskLabels, ['legacy_windows', 'weak_tls']);
  });

  it('能力门禁允许 L2 最小能力，缺少 file.write 时降级到脚本包', () => {
    const gate = new LegacyCapabilityGate();
    const allowed = gate.evaluate(profile(), ['file.write', 'process.exec']);
    const degraded = gate.evaluate(profile({
      capabilities: [
        { key: 'agent.legacy.online', value: true },
        { key: 'process.exec', value: true },
        { key: 'backup.create', value: true },
        { key: 'verify.basic', value: true },
      ],
    }), ['file.write']);

    assert.equal(allowed.decision, 'allow');
    assert.equal(allowed.selectedPath, 'legacy_task');
    assert.equal(degraded.decision, 'degrade');
    assert.equal(degraded.selectedPath, 'script_package');
    assert.deepEqual(degraded.missingCapabilities, ['file.write']);
  });

  it('L4/L5 给出 script_package/manual_result/monitor_only 降级建议', () => {
    const gate = new LegacyCapabilityGate();
    const l4 = gate.evaluate(profile({ compatibilityLevel: 'L4', protocolMode: 'offline_result' }), ['file.write']);
    const l5 = gate.evaluate(profile({ compatibilityLevel: 'L5', protocolMode: 'offline_result' }), ['file.write']);

    assert.deepEqual(l4.suggestions.map((item) => item.path), ['script_package', 'manual_result']);
    assert.equal(l4.selectedPath, 'script_package');
    assert.deepEqual(l5.suggestions.map((item) => item.path), ['monitor_only', 'manual_result']);
    assert.equal(l5.decision, 'block');
  });

  it('LegacyTaskTranslator 保留 idempotencyKey、risk、requiredCapabilities 并只生成白名单动作', () => {
    const translator = new LegacyTaskTranslator();
    const translated = translator.translate(profile(), step());

    assert.equal(translated.mode, 'legacy_task');
    assert.equal(translated.legacyTask?.idempotencyKey, 'idem_legacy_001');
    assert.equal(translated.legacyTask?.risk, 'medium');
    assert.equal(translated.legacyTask?.requiredCapabilities.includes('backup.create'), true);
    assert.equal(translated.legacyTask?.actions.every((action) => ['backup', 'write_file', 'exec', 'verify_file'].includes(action.type)), true);
    assert.equal(translated.legacyTask?.actions.find((action) => action.type === 'write_file')?.sensitive, true);
  });

  it('LegacyTaskTranslator 在 L4 生成 script package plan，仍保留幂等和能力信息', () => {
    const translator = new LegacyTaskTranslator();
    const translated = translator.translate(profile({ compatibilityLevel: 'L4', protocolMode: 'offline_result' }), step());

    assert.equal(translated.mode, 'script_package_plan');
    assert.equal(translated.scriptPackagePlan?.idempotencyKey, 'idem_legacy_001');
    assert.equal(translated.scriptPackagePlan?.requiredCapabilities.includes('file.write'), true);
    assert.match(translated.scriptPackagePlan?.packageId ?? '', /^spkg_[a-f0-9]{24}$/);
  });

  it('ScriptPackageService 生成 manifest、占位脚本和稳定 hash，不写真实证书明文', () => {
    const translator = new LegacyTaskTranslator();
    const plan = translator.translate(profile({ compatibilityLevel: 'L4', protocolMode: 'offline_result' }), step()).scriptPackagePlan as ScriptPackagePlan;
    const service = new ScriptPackageService();
    const bundle = service.createBundle(plan);
    const repeated = service.createBundle(plan);

    assert.equal(bundle.manifest.manifestId, `${plan.packageId}.manifest`);
    assert.equal(bundle.manifest.signature, repeated.manifest.signature);
    assert.equal(bundle.artifacts.length, 4);
    assert.equal(bundle.manifest.artifactHashes.install, bundle.artifacts.find((artifact) => artifact.name === 'install')?.sha256);
    assert.equal(bundle.artifacts.some((artifact) => artifact.content.includes('BEGIN PRIVATE KEY')), false);
    assert.equal(bundle.artifacts.some((artifact) => artifact.content.includes('secret://certificates/cert_001')), true);
  });

  it('result upload 校验 manifestId、hash、evidenceRef、operator/auditRef，缺证据只能人工未验证', () => {
    const plan = new LegacyTaskTranslator()
      .translate(profile({ compatibilityLevel: 'L4', protocolMode: 'offline_result' }), step()).scriptPackagePlan as ScriptPackagePlan;
    const service = new ScriptPackageService();
    const bundle = service.createBundle(plan);
    const valid = service.ingestResult(bundle.manifest, {
      manifestId: bundle.manifest.manifestId,
      packageId: bundle.manifest.packageId,
      planId: bundle.manifest.planId,
      targetId: bundle.manifest.targetId,
      phase: 'verify',
      status: 'success',
      certificateFingerprint: bundle.manifest.certificateFingerprint,
      evidenceRef: 'evidence://openssl-output-001',
      artifactHashes: { verify: bundle.manifest.artifactHashes.verify },
      operator: 'operator_001',
      auditRef: 'audit_001',
    });
    const missingEvidence = service.ingestResult(bundle.manifest, {
      manifestId: bundle.manifest.manifestId,
      packageId: bundle.manifest.packageId,
      planId: bundle.manifest.planId,
      targetId: bundle.manifest.targetId,
      phase: 'install',
      status: 'success',
      certificateFingerprint: bundle.manifest.certificateFingerprint,
      artifactHashes: { install: bundle.manifest.artifactHashes.install },
      operator: 'operator_001',
      auditRef: 'audit_002',
    });
    const mismatch = service.ingestResult(bundle.manifest, {
      manifestId: 'wrong.manifest',
      packageId: bundle.manifest.packageId,
      planId: bundle.manifest.planId,
      targetId: bundle.manifest.targetId,
      phase: 'verify',
      status: 'success',
      certificateFingerprint: bundle.manifest.certificateFingerprint,
      evidenceRef: 'evidence://openssl-output-001',
      artifactHashes: { verify: 'bad_hash' },
      operator: 'operator_001',
      auditRef: 'audit_003',
    });

    assert.equal(valid.accepted, true);
    assert.equal(valid.verificationState, 'verified');
    assert.equal(missingEvidence.accepted, true);
    assert.equal(missingEvidence.verificationState, 'manual_unverified');
    assert.equal(mismatch.accepted, false);
    assert.equal(mismatch.verificationState, 'failed');
  });

  it('LegacyTaskDispatcher 支持任务下发、结果回传、检查点和幂等保护', () => {
    const translator = new LegacyTaskTranslator();
    const legacyTask = translator.translate(profile(), step()).legacyTask!;
    const dispatcher = new LegacyTaskDispatcher();
    const dispatched = dispatcher.dispatch(profile(), legacyTask, new Date('2026-06-08T00:00:00.000Z'));
    const repeated = dispatcher.dispatch(profile(), legacyTask, new Date('2026-06-08T00:01:00.000Z'));
    const acknowledged = dispatcher.acknowledge(dispatched.id, profile().agentId, 'lease_001', new Date('2026-06-08T00:02:00.000Z'));
    const running = dispatcher.markRunning(dispatched.id, 'lease_001', new Date('2026-06-08T00:03:00.000Z'));
    const completed = dispatcher.complete(dispatched.id, 'lease_001', {
      taskId: legacyTask.taskId,
      status: 'success',
      evidenceRef: 'evidence://legacy-agent-output-001',
      auditRef: 'audit_legacy_001',
      operator: 'agent_legacy_001',
    }, new Date('2026-06-08T00:04:00.000Z'));

    assert.equal(repeated.id, dispatched.id);
    assert.equal(acknowledged.status, 'dispatched');
    assert.equal(running.status, 'running');
    assert.equal(completed.status, 'completed');
    assert.deepEqual(completed.checkpoints.map((item) => item.kind), ['queued', 'dispatched', 'running', 'result_received', 'verified']);
  });

  it('LegacyTaskDispatcher 接收脚本包结果并把缺证据结果停在 manual_unverified 检查点', () => {
    const plan = new LegacyTaskTranslator()
      .translate(profile({ compatibilityLevel: 'L4', protocolMode: 'offline_result' }), step()).scriptPackagePlan as ScriptPackagePlan;
    const scriptPackageService = new ScriptPackageService();
    const bundle = scriptPackageService.createBundle(plan);
    const dispatcher = new LegacyTaskDispatcher(scriptPackageService);
    const ingested = dispatcher.ingestScriptPackageResult(bundle.manifest, {
      manifestId: bundle.manifest.manifestId,
      packageId: bundle.manifest.packageId,
      planId: bundle.manifest.planId,
      targetId: bundle.manifest.targetId,
      phase: 'install',
      status: 'success',
      certificateFingerprint: bundle.manifest.certificateFingerprint,
      artifactHashes: { install: bundle.manifest.artifactHashes.install },
      operator: 'operator_001',
      auditRef: 'audit_script_001',
    }, new Date('2026-06-08T00:05:00.000Z'));
    const repeated = dispatcher.ingestScriptPackageResult(bundle.manifest, ingested.result);

    assert.equal(repeated, ingested);
    assert.equal(ingested.ingest.accepted, true);
    assert.equal(ingested.ingest.verificationState, 'manual_unverified');
    assert.deepEqual(ingested.checkpoints.map((item) => item.kind), ['result_received', 'manual_unverified']);
  });
});
