import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuditLogEntity } from '../../persistence/entities/audit-log.entity.js';
import type { CertificatesRepository } from '../certificates/repository/certificates.repository.js';
import { buildAuditPresentationContext, emptyAuditPresentationContext, presentAuditLog } from './audit-presentation.service.js';

function audit(input: Partial<AuditLogEntity>): AuditLogEntity {
  return {
    id: 'aud_test',
    tenantId: 'tenant_test',
    eventType: 'audit.event',
    actorType: 'user',
    actorId: 'user_admin',
    action: 'audit.read',
    resourceType: 'auditLog',
    resourceId: 'audit_log_internal_id',
    result: 'success',
    riskLevel: 'low',
    createdAt: '2026-08-15T00:00:00.000Z',
    ...input,
  };
}

describe('AuditPresentationService 业务摘要', () => {
  it('将 CA 同步失败翻译为对象类型和业务错误', () => {
    const result = presentAuditLog(audit({
      eventType: 'ca.operations.sync.failed',
      action: 'ca.operations.sync',
      resourceType: 'caSyncRun',
      resourceId: 'casync_internal_id',
      actorId: 'system_ca_auto_sync',
      result: 'failure',
      detail: {
        objectType: 'request',
        errorCode: 'CA_SYNC_SOURCE_UNAVAILABLE',
      },
    }), emptyAuditPresentationContext());

    assert.equal(result.summary, '系统同步证书申请记录失败：同步源暂不可用。');
    assert.doesNotMatch(result.summary ?? '', /casync_internal_id|CA_SYNC_SOURCE_UNAVAILABLE/);
  });

  it('将任务类型翻译为后台任务用途', () => {
    const result = presentAuditLog(audit({
      eventType: 'task.created',
      action: 'task.create',
      resourceType: 'task',
      resourceId: 'task_internal_id',
      detail: { taskType: 'PLUGIN_REFERENCE_REFRESH' },
    }), emptyAuditPresentationContext());

    assert.equal(result.summary, '管理员创建“插件目录刷新任务”。');
    assert.doesNotMatch(result.summary ?? '', /task_internal_id/);
  });

  it('将权限拒绝翻译为缺少权限的业务原因', () => {
    const result = presentAuditLog(audit({
      eventType: 'permission.denied',
      action: 'task.read',
      resourceType: 'task',
      resourceId: 'task_internal_id',
      actorId: 'external_ids_source_internal_user',
      result: 'denied',
      detail: { reason: 'no allow policy' },
    }), emptyAuditPresentationContext());

    assert.equal(result.summary, '外部身份用户因没有匹配的允许策略，访问后台任务的“读取任务”操作被拒绝。');
    assert.doesNotMatch(result.summary ?? '', /external_ids|task_internal_id/);
  });

  it('将 Secret purpose 翻译为凭据用途且不泄露 Secret 引用', () => {
    const result = presentAuditLog(audit({
      eventType: 'secret.used',
      action: 'secret.resolve.service',
      resourceType: 'secret',
      resourceId: 'sec_internal_id',
      actorId: 'ids_external_source',
      detail: {
        purpose: 'certificate.deployment.private_key',
        secretRef: 'secret://password/sec_internal_id#current',
      },
    }), emptyAuditPresentationContext());

    assert.equal(result.summary, '身份源服务读取证书部署私钥。');
    assert.doesNotMatch(result.summary ?? '', /sec_internal_id|secret:\/\//);
  });

  it('将外部登录翻译为身份源登录', () => {
    const result = presentAuditLog(audit({
      eventType: 'auth.external_login.success',
      action: 'auth.external_login',
      resourceType: 'identitySource',
      resourceId: 'ids_internal_id',
      actorId: 'external_ids_source_internal_user',
      detail: { sourceType: 'active_directory' },
    }), emptyAuditPresentationContext());

    assert.equal(result.summary, '外部身份用户通过Active Directory身份源登录成功。');
    assert.doesNotMatch(result.summary ?? '', /external_ids|ids_internal_id/);
  });

  it('优先使用 detail 中的对象名称', () => {
    const result = presentAuditLog(audit({
      eventType: 'automation.updated',
      action: 'automation.update',
      resourceType: 'automation',
      resourceId: 'aut_internal_id',
      detail: { after: { name: '证书自动部署（aut_internal_id）' } },
    }), emptyAuditPresentationContext());

    assert.match(result.summary ?? '', /证书自动部署/);
    assert.doesNotMatch(result.summary ?? '', /aut_internal_id/);
  });

  it('未知类型仍只显示业务类型，不回退为内部对象 ID', () => {
    const result = presentAuditLog(audit({
      eventType: 'future.internal_action',
      action: 'future.internal_action',
      resourceType: 'futureResource',
      resourceId: 'future_internal_id',
    }), emptyAuditPresentationContext());

    assert.equal(result.summary, '管理员完成“执行操作”，对象：业务对象。');
    assert.doesNotMatch(result.summary ?? '', /future_internal_id/);
  });

  it('从证书资产和版本数据库关联翻译已删除的证书产物', async () => {
    const asset = {
      id: 'certasset_test',
      name: '*.example.com',
      primaryDomain: '*.example.com',
      sans: ['*.example.com'],
      sourceType: 'manual' as const,
      status: 'active' as const,
      tags: [],
      createdBy: 'user_admin',
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
    };
    const version = {
      id: 'certver_test',
      certificateAssetId: asset.id,
      versionNo: 3,
      commonName: '*.example.com',
      sans: ['*.example.com'],
      issuer: { raw: 'issuer' },
      subject: { raw: 'subject' },
      serialNumber: 'serial',
      notBefore: '2026-08-15T00:00:00.000Z',
      notAfter: '2027-08-15T00:00:00.000Z',
      fingerprintSha256: 'fingerprint',
      publicKeyAlgorithm: 'RSA',
      signatureAlgorithm: 'SHA256',
      leafStorageRef: 'storage://certificate',
      chainCertificateRefs: [],
      chainOrder: [],
      chainDiagnostics: [],
      chainStatus: 'valid' as const,
      deployable: true,
      sourceType: 'manual' as const,
      activationState: 'promoted' as const,
      status: 'active' as const,
      createdBy: 'user_admin',
      createdAt: '2026-08-15T00:00:00.000Z',
    };
    const certificates = {
      listAssets: async () => ({ items: [], page: 1, pageSize: 1000, total: 0 }),
      listVersions: async () => ({ items: [], page: 1, pageSize: 1000, total: 0 }),
      listFormats: async () => ({ items: [], page: 1, pageSize: 1000, total: 0 }),
      getAsset: async (id: string) => id === asset.id ? asset : undefined,
      getVersion: async (id: string) => id === version.id ? version : undefined,
      getFormat: async () => undefined,
    } as unknown as CertificatesRepository;
    const log = audit({
      action: 'certificate.format.delete',
      eventType: 'certificate.imported',
      resourceType: 'certificate_version_format',
      resourceId: 'certfmt_deleted',
      detail: { certificateVersionId: version.id, format: 'pem' },
    });
    const context = await buildAuditPresentationContext({
      tenantId: 'tenant_test',
      auditLogs: [log],
      deploymentPlans: {
        getPlan: async () => undefined,
        listTargetsByPlan: async () => [],
      } as never,
      applicationAssets: [],
      bindings: [],
      certificates,
    });

    const result = presentAuditLog(log, context);
    assert.equal(result.summary, '管理员完成“删除证书产物”，对象：证书产物 *.example.com v3 / PEM。');
    assert.doesNotMatch(result.summary ?? '', /certfmt_|certver_/);
  });
});
