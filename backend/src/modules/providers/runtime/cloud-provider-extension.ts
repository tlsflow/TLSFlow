import { AppError } from '../../../common/errors/app-error.js';
import type {
  ProviderOperationResult,
  ProviderExtensionDescriptor,
} from '../dto/providers.dto.js';
import type {
  ProviderContext,
  ProviderExtension,
  ProviderTargetRef,
} from '../domain/provider-extension.js';
import {
  assertProviderResponse,
  type ProviderCredentialResolver,
  type ProviderHttpResponse,
  type ProviderTransport,
  stringValue,
} from './provider-runtime.js';
import type { ProviderAsyncState } from './provider-async-waiter.js';

export interface CloudCertificateInput {
  certificatePem: string;
  privateKeyPem?: string;
  chainPem?: string;
  certificateId?: string;
}

export interface CloudTargetState {
  target: ProviderTargetRef;
  certificateId?: string;
  fingerprintSha256?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderAsyncOperation {
  operationId: string;
  status?: string;
  detail?: Record<string, unknown>;
}

export abstract class CloudProviderExtension implements ProviderExtension {
  readonly descriptor: ProviderExtensionDescriptor;

  protected constructor(
    descriptor: ProviderExtensionDescriptor,
    protected readonly credentials: ProviderCredentialResolver,
    protected readonly transport: ProviderTransport,
  ) {
    this.descriptor = descriptor;
  }

  async testConnection(context: ProviderContext): Promise<{ reachable: boolean; accountId?: string; details?: Record<string, unknown> }> {
    const response = await this.call(context, 'connection');
    const payload = assertProviderResponse(response, context.asset.providerKey);
    return {
      reachable: true,
      accountId: stringValue(payload.accountId) ?? context.asset.accountId,
      details: { providerKey: context.asset.providerKey, responseKeys: Object.keys(payload).sort() },
    };
  }

  async discover(context: ProviderContext, frameworkTypes?: string[]): Promise<Record<string, unknown>> {
    const targets = await this.discoverTargets(context, frameworkTypes);
    return {
      apiVersion: 'gcac.device-discovery/v2',
      device: {
        stableKey: context.asset.id,
        displayName: context.asset.displayName,
        productFamily: context.asset.providerKey,
        managementAddress: context.asset.scope.endpoint,
        metadata: { accountId: context.asset.accountId, scope: context.asset.scope },
      },
      capabilities: this.descriptor.supportedOperations.map((key) => ({ key, available: true })),
      frameworks: targets.frameworks,
      sites: targets.sites,
      managedTargets: targets.managedTargets,
      certificates: targets.certificates,
      certificateBindings: targets.certificateBindings,
      warnings: targets.warnings ?? [],
      rawFacts: targets.rawFacts,
    };
  }

  async execute(
    operationKey: string,
    context: ProviderContext,
    target: ProviderTargetRef,
    input: Record<string, unknown>,
  ): Promise<ProviderOperationResult> {
    const operationId = `${context.requestId ?? 'provider'}:${Date.now()}`;
    if (operationKey === 'certificate.discover') {
      const discovery = await this.discover(context, [target.frameworkType]);
      return success(operationId, context.asset.providerKey, operationKey, discovery);
    }
    if (operationKey === 'certificate.deploy') {
      const certificate = readCertificateInput(input);
      const before = await this.readTargetState(context, target);
      const uploaded = await this.uploadCertificate(context, certificate);
      const applied = await this.applyCertificate(context, target, uploaded.certificateId, certificate);
      const asyncOperation = readAsyncOperation(applied);
      const asyncResult = asyncOperation
        ? await this.waitForAsyncOperation(context, target, asyncOperation, input)
        : undefined;
      return success(operationId, context.asset.providerKey, operationKey, {
        previous: before,
        certificateId: uploaded.certificateId,
        applied,
        ...(asyncResult ? { asyncOperation: asyncResult } : {}),
        checkpoint: { target, previous: before },
      });
    }
    if (operationKey === 'certificate.verify') {
      const verified = await this.verifyCertificate(context, target, input);
      return verified
        ? success(operationId, context.asset.providerKey, operationKey, { verified: true })
        : failed(operationId, context.asset.providerKey, operationKey, '证书验证未通过');
    }
    if (operationKey === 'certificate.rollback') {
      const checkpoint = readCheckpoint(input);
      if (!checkpoint.previous?.certificateId) {
        throw new AppError('PROVIDER_ROLLBACK_UNAVAILABLE', '没有可恢复的旧证书 ID', { providerKey: context.asset.providerKey });
      }
      await this.restoreCertificate(context, checkpoint.target, checkpoint.previous.certificateId, checkpoint.previous);
      return success(operationId, context.asset.providerKey, operationKey, { restoredCertificateId: checkpoint.previous.certificateId });
    }
    throw new AppError('PROVIDER_OPERATION_UNSUPPORTED', 'Provider 扩展不支持该操作', {
      providerKey: context.asset.providerKey,
      operationKey,
    });
  }

  protected abstract call(context: ProviderContext, action: string, payload?: Record<string, unknown>): Promise<ProviderHttpResponse>;
  protected abstract discoverTargets(context: ProviderContext, frameworkTypes?: string[]): Promise<DiscoveryTargets>;
  protected abstract readTargetState(context: ProviderContext, target: ProviderTargetRef): Promise<CloudTargetState>;
  protected abstract uploadCertificate(context: ProviderContext, certificate: CloudCertificateInput): Promise<{ certificateId: string }>;
  protected abstract applyCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string, certificate: CloudCertificateInput): Promise<Record<string, unknown>>;
  protected abstract verifyCertificate(context: ProviderContext, target: ProviderTargetRef, input: Record<string, unknown>): Promise<boolean>;
  protected abstract restoreCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string, previous: CloudTargetState): Promise<void>;

  protected async waitForAsyncOperation(
    _context: ProviderContext,
    _target: ProviderTargetRef,
    operation: ProviderAsyncOperation,
    _input: Record<string, unknown>,
  ): Promise<ProviderAsyncState> {
    return { status: 'SUCCEEDED', detail: operation.detail };
  }

  protected async credential(context: ProviderContext): Promise<Record<string, string>> {
    return this.credentials.resolve(context.asset);
  }
}

function readAsyncOperation(value: Record<string, unknown>): ProviderAsyncOperation | undefined {
  const candidate = value.asyncOperation;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const record = candidate as Record<string, unknown>;
  const operationId = stringValue(record.operationId) ?? stringValue(record.taskId);
  return operationId
    ? {
      operationId,
      status: stringValue(record.status),
      detail: record.detail && typeof record.detail === 'object' && !Array.isArray(record.detail)
        ? record.detail as Record<string, unknown>
        : undefined,
    }
    : undefined;
}

export interface DiscoveryTargets {
  frameworks: Array<Record<string, unknown>>;
  sites: Array<Record<string, unknown>>;
  managedTargets: Array<Record<string, unknown>>;
  certificates: Array<Record<string, unknown>>;
  certificateBindings: Array<Record<string, unknown>>;
  warnings?: Array<Record<string, unknown>>;
  rawFacts?: Record<string, unknown>;
}

function readCertificateInput(input: Record<string, unknown>): CloudCertificateInput {
  const certificatePem = stringValue(input.certificatePem);
  if (!certificatePem) throw new AppError('VALIDATION_FAILED', '证书部署缺少 certificatePem');
  return {
    certificatePem,
    privateKeyPem: stringValue(input.privateKeyPem),
    chainPem: stringValue(input.chainPem),
    certificateId: stringValue(input.certificateId),
  };
}

function readCheckpoint(input: Record<string, unknown>): { target: ProviderTargetRef; previous?: CloudTargetState } {
  const value = input.checkpoint;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('PROVIDER_ROLLBACK_UNAVAILABLE', '证书回滚缺少 checkpoint');
  }
  const checkpoint = value as Record<string, unknown>;
  const target = checkpoint.target;
  const previous = checkpoint.previous;
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new AppError('PROVIDER_ROLLBACK_UNAVAILABLE', 'checkpoint 缺少目标引用');
  }
  return {
    target: target as ProviderTargetRef,
    previous: previous && typeof previous === 'object' && !Array.isArray(previous) ? previous as CloudTargetState : undefined,
  };
}

function success(operationId: string, providerKey: string, operationKey: string, resultSummary: Record<string, unknown>): ProviderOperationResult {
  return { operationId, providerKey, operationKey, status: 'SUCCESS', resultSummary };
}

function failed(operationId: string, providerKey: string, operationKey: string, message: string): ProviderOperationResult {
  return { operationId, providerKey, operationKey, status: 'FAILED', resultSummary: { message } };
}
