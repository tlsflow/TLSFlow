import { createHash, createHmac } from 'node:crypto';
import { canonicalize } from '../../shared/canonical-json.js';
import type {
  ScriptPackageArtifact,
  ScriptPackageBundle,
  ScriptPackageManifest,
  ScriptPackagePlan,
  ScriptPackageResult,
  ScriptPackageResultIngest,
} from './legacy-agent.types.js';

const MANIFEST_VERSION = '1.0.0';
const SIGNING_LABEL = 'gcac-script-package-mock-safe-v1';

export class ScriptPackageService {
  createBundle(plan: ScriptPackagePlan): ScriptPackageBundle {
    const artifacts = buildArtifacts(plan);
    const artifactHashes = Object.fromEntries(artifacts.map((artifact) => [artifact.name, artifact.sha256])) as ScriptPackageManifest['artifactHashes'];
    const unsignedManifest: Omit<ScriptPackageManifest, 'signature'> = {
      manifestId: `${plan.packageId}.manifest`,
      packageId: plan.packageId,
      manifestVersion: MANIFEST_VERSION,
      tenantId: plan.tenantId,
      planId: plan.planId,
      executionId: plan.executionId,
      stepId: plan.stepId,
      targetId: plan.targetId,
      certificateFingerprint: plan.certificateFingerprint,
      certificateFormat: plan.certificateFormat,
      targetPaths: plan.targetPaths,
      commands: {
        install: './install.placeholder',
        verify: './verify.placeholder',
        rollback: './rollback.placeholder',
      },
      backupPolicy: plan.backupPolicy,
      expectedVerification: plan.expectedVerification,
      expiresAt: plan.expiresAt,
      artifactHashes,
    };

    return {
      manifest: {
        ...unsignedManifest,
        signature: signManifest(unsignedManifest),
      },
      artifacts,
    };
  }

  ingestResult(manifest: ScriptPackageManifest, result: ScriptPackageResult): ScriptPackageResultIngest {
    const reasons: string[] = [];
    if (result.manifestId !== manifest.manifestId) reasons.push('manifestId 不匹配。');
    if (result.packageId !== manifest.packageId) reasons.push('packageId 不匹配。');
    if (result.planId !== manifest.planId) reasons.push('planId 不匹配。');
    if (result.targetId !== manifest.targetId) reasons.push('targetId 不匹配。');
    if (result.certificateFingerprint && result.certificateFingerprint !== manifest.certificateFingerprint) reasons.push('certificateFingerprint 不匹配。');
    if (!result.evidenceRef) reasons.push('缺少 evidenceRef，不能作为可信验证。');
    if (!result.operator) reasons.push('缺少 operator。');
    if (!result.auditRef) reasons.push('缺少 auditRef。');

    for (const [name, hash] of Object.entries(result.artifactHashes)) {
      const expected = manifest.artifactHashes[name as keyof ScriptPackageManifest['artifactHashes']];
      if (hash !== expected) reasons.push(`${name} hash 不匹配。`);
    }

    if (Number.isNaN(Date.parse(manifest.expiresAt))) {
      reasons.push('manifest expiresAt 不合法。');
    }

    if (new Date(manifest.expiresAt).getTime() < Date.now()) {
      reasons.push('脚本包已过期，需要人工复核。');
    }

    const hardMismatch = reasons.some((reason) => reason.includes('不匹配'));
    if (hardMismatch) {
      return {
        accepted: false,
        resultStatus: result.status,
        verificationState: 'failed',
        reasons,
        auditRef: result.auditRef,
      };
    }

    if (result.status !== 'success' || !result.evidenceRef || result.phase !== 'verify') {
      return {
        accepted: true,
        resultStatus: 'manual_unverified',
        verificationState: 'manual_unverified',
        reasons: reasons.length ? reasons : ['结果未提供 verify 成功证据，不能标记为自动验证成功。'],
        auditRef: result.auditRef,
      };
    }

    return {
      accepted: true,
      resultStatus: result.status,
      verificationState: 'verified',
      reasons,
      auditRef: result.auditRef,
    };
  }
}

function buildArtifacts(plan: ScriptPackagePlan): ScriptPackageArtifact[] {
  const scripts: Array<Omit<ScriptPackageArtifact, 'sha256'>> = [
    {
      name: 'install',
      filename: 'install.placeholder',
      content: [
        '# GCAC Legacy 脚本包占位 install',
        '# 不包含真实证书或私钥明文，只引用受控 certificateRef。',
        `CERTIFICATE_REF="${escapeForPlaceholder(plan.certificateRef)}"`,
        `EXPECTED_FINGERPRINT="${escapeForPlaceholder(plan.certificateFingerprint)}"`,
        `OPERATOR_COMMAND="${escapeForPlaceholder(plan.installCommand ?? 'manual install command required')}"`,
      ].join('\n'),
    },
    {
      name: 'verify',
      filename: 'verify.placeholder',
      content: [
        '# GCAC Legacy 脚本包占位 verify',
        '# 操作员需要在目标侧执行真实验证并上传 evidenceRef。',
        `EXPECTED_VERIFICATION='${escapeForPlaceholder(canonicalize(plan.expectedVerification))}'`,
        `OPERATOR_COMMAND="${escapeForPlaceholder(plan.verifyCommand ?? 'manual verify command required')}"`,
      ].join('\n'),
    },
    {
      name: 'rollback',
      filename: 'rollback.placeholder',
      content: [
        '# GCAC Legacy 脚本包占位 rollback',
        '# 回滚必须使用本地 backupRef，不由平台保存私钥明文。',
        `BACKUP_REQUIRED="${String(plan.backupPolicy.required)}"`,
        `OPERATOR_COMMAND="${escapeForPlaceholder(plan.rollbackCommand ?? 'manual rollback command required')}"`,
      ].join('\n'),
    },
    {
      name: 'resultTemplate',
      filename: 'result.template.json',
      content: canonicalize({
        manifestId: `${plan.packageId}.manifest`,
        packageId: plan.packageId,
        planId: plan.planId,
        targetId: plan.targetId,
        phase: 'verify',
        status: 'manual_unverified',
        certificateFingerprint: plan.certificateFingerprint,
        evidenceRef: 'evidence://replace-me',
        operator: 'operator-id',
        auditRef: 'audit://replace-me',
      }),
    },
  ];

  return scripts.map((script) => ({
    ...script,
    sha256: sha256(script.content),
  }));
}

function signManifest(manifest: Omit<ScriptPackageManifest, 'signature'>): string {
  return createHmac('sha256', SIGNING_LABEL).update(canonicalize(manifest)).digest('hex');
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function escapeForPlaceholder(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ');
}
