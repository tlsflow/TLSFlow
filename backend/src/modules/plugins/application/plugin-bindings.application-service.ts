import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type { CapabilityAssignmentV1, CertificateMaterialDescriptor, NormalizedPluginRuntimeInput, PluginBindingV1 } from '../dto/plugin-bindings.dto.js';
import { PluginBindingsRepository } from '../repository/plugin-bindings.repository.js';

export interface CertificateArtifactGeneratorPort {
  generateDeploymentArtifactFromFormat(input: { certificateVersionId: string; certificateFormatId: string; createdBy: string }): Promise<{
    certificateVersionId: string; certificateFormatId: string; format: string; certificatePem?: string; privateKeyPem?: string;
    pfxBase64?: string; files: Array<{ fileName: string; contentBase64: string; sha256: string; size: number }>;
  }>;
}

type CreatePluginBindingInput = Omit<PluginBindingV1, 'id' | 'tenantId' | 'status' | 'version' | 'createdAt' | 'updatedAt'>;

export class PluginBindingsApplicationService {
  constructor(private readonly repository = new PluginBindingsRepository()) {}

  async getBinding(bindingId: string): Promise<PluginBindingV1 | undefined> {
    return this.repository.getBinding(bindingId);
  }

  async getTenantBinding(tenantId: string, bindingId: string): Promise<PluginBindingV1> {
    const binding = await this.repository.getBinding(bindingId);
    if (!binding || binding.tenantId !== tenantId) throw new AppError('RESOURCE_NOT_FOUND', 'PluginBinding 不存在', { bindingId });
    return binding;
  }

  async updateBinding(
    tenantId: string,
    bindingId: string,
    input: Partial<Pick<PluginBindingV1, 'inputBindings' | 'managedContext' | 'status'>> & { expectedVersion: number },
  ): Promise<PluginBindingV1> {
    const binding = await this.getTenantBinding(tenantId, bindingId);
    if (binding.version !== input.expectedVersion) throw new AppError('RESOURCE_VERSION_CONFLICT', 'PluginBinding 版本冲突', { bindingId, expectedVersion: input.expectedVersion, actualVersion: binding.version });
    if (binding.mode === 'STANDALONE' && input.managedContext) throw new AppError('VALIDATION_FAILED', 'Standalone Binding 不能保存 managedContext');
    assertManagedContext(input.managedContext);
    const next = {
      ...binding,
      inputBindings: input.inputBindings ?? binding.inputBindings,
      managedContext: input.managedContext ?? binding.managedContext,
      status: input.status ?? binding.status,
      version: binding.version + 1,
      updatedAt: new Date().toISOString(),
    };
    return this.repository.saveBinding(next);
  }

  async createBinding(tenantId: string, input: CreatePluginBindingInput): Promise<PluginBindingV1> {
    if (input.mode === 'MANAGED' && !input.managedContext?.hostId) throw new AppError('VALIDATION_FAILED', 'Managed Binding 必须提供 hostId');
    if (input.mode === 'STANDALONE' && input.managedContext) throw new AppError('VALIDATION_FAILED', 'Standalone Binding 不能保存 managedContext');
    assertManagedContext(input.managedContext);
    for (const [slot, value] of Object.entries(input.inputBindings.credentials)) {
      if (!slot.trim() || !value.credentialId?.trim()) throw new AppError('VALIDATION_FAILED', 'Credential Binding 必须使用非空 credentialId');
    }
    const now = new Date().toISOString();
    return this.repository.saveBinding({ ...input, id: newId('plgb'), tenantId, status: 'ACTIVE', version: 1, createdAt: now, updatedAt: now });
  }

  async assignCapability(tenantId: string, input: Omit<CapabilityAssignmentV1, 'id' | 'tenantId' | 'status' | 'createdAt' | 'updatedAt'>): Promise<CapabilityAssignmentV1> {
    const binding = await this.repository.getBinding(input.pluginBindingId);
    if (!binding || binding.tenantId !== tenantId || binding.pluginVersionId !== input.pluginVersionId) throw new AppError('VALIDATION_FAILED', 'Capability Assignment 与 Binding 不一致');
    const now = new Date().toISOString();
    return this.repository.saveAssignment({ ...input, id: newId('capa'), tenantId, status: 'ACTIVE', createdAt: now, updatedAt: now });
  }

  async disableOwnerAssignment(tenantId: string, input: { ownerType: CapabilityAssignmentV1['ownerType']; ownerId: string; capabilityKey: string }): Promise<void> {
    await this.repository.disableAssignment(tenantId, input.ownerType, input.ownerId, input.capabilityKey, new Date().toISOString());
  }

  async listAssignmentCandidates(tenantId: string, capabilityKey: string, owners: { deviceId?: string; managedTargetId?: string; applicationAssetId?: string }): Promise<CapabilityAssignmentV1[]> {
    const assignments = await this.repository.listAssignments(tenantId, capabilityKey);
    return [
      assignments.find((item) => item.ownerType === 'APPLICATION_ASSET' && item.ownerId === owners.applicationAssetId),
      assignments.find((item) => item.ownerType === 'MANAGED_TARGET' && item.ownerId === owners.managedTargetId),
      assignments.find((item) => item.ownerType === 'DEVICE' && item.ownerId === owners.deviceId),
    ].filter((item): item is CapabilityAssignmentV1 => Boolean(item));
  }

  async resolveAssignment(tenantId: string, capabilityKey: string, owners: { deviceId?: string; managedTargetId?: string; applicationAssetId?: string }): Promise<CapabilityAssignmentV1 | undefined> {
    return (await this.listAssignmentCandidates(tenantId, capabilityKey, owners))[0];
  }

  async normalizeRuntimeInput(bindingId: string, capabilityKey: string, options: { executionLocation: NormalizedPluginRuntimeInput['executionLocation']; target: Record<string, unknown>; certificateMaterials?: Record<string, CertificateMaterialDescriptor> }): Promise<NormalizedPluginRuntimeInput> {
    const binding = await this.repository.getBinding(bindingId);
    if (!binding || binding.status !== 'ACTIVE') throw new AppError('RESOURCE_NOT_FOUND', '可用 PluginBinding 不存在', { bindingId });
    const payload = {
      pluginVersionId: binding.pluginVersionId, mode: binding.mode, capabilityKey, executionLocation: options.executionLocation,
      connections: binding.inputBindings.connections, variables: binding.inputBindings.variables, credentials: binding.inputBindings.credentials,
      certificateMaterials: options.certificateMaterials ?? {}, target: options.target,
    };
    return { ...payload, normalizedSha256: createHash('sha256').update(stable(payload)).digest('hex') };
  }
}

export class CertificateArtifactBindingResolver {
  constructor(private readonly certificates: CertificateArtifactGeneratorPort) {}

  async resolve(input: { certificateVersionId: string; createdBy: string; bindings: PluginBindingV1['inputBindings']['artifacts'] }): Promise<Record<string, CertificateMaterialDescriptor>> {
    const output: Record<string, CertificateMaterialDescriptor> = {};
    for (const [variableName, binding] of Object.entries(input.bindings)) {
      if (!binding.certificateFormatId) throw new AppError('VALIDATION_FAILED', '证书 Artifact Binding 必须指定 certificateFormatId', { variableName });
      const generated = await this.certificates.generateDeploymentArtifactFromFormat({ certificateVersionId: input.certificateVersionId, certificateFormatId: binding.certificateFormatId, createdBy: input.createdBy });
      const candidates: Record<string, { value: string; sensitive: boolean }> = {};
      if (generated.certificatePem) candidates.certificatePem = { value: generated.certificatePem, sensitive: false };
      if (generated.privateKeyPem) candidates.privateKeyPem = { value: generated.privateKeyPem, sensitive: true };
      if (generated.pfxBase64) candidates.pfxBase64 = { value: generated.pfxBase64, sensitive: true };
      for (const file of generated.files) candidates[file.fileName] = { value: file.contentBase64, sensitive: true };
      const outputs: CertificateMaterialDescriptor['outputs'] = {};
      for (const [slot, source] of Object.entries(binding.outputBindings)) {
        const candidate = candidates[source];
        if (!candidate) throw new AppError('VALIDATION_FAILED', '证书产物输出槽位不存在', { variableName, slot, source });
        outputs[slot] = { artifactRef: `memory://${variableName}/${slot}`, sha256: createHash('sha256').update(candidate.value).digest('hex'), size: Buffer.byteLength(candidate.value), sensitive: candidate.sensitive };
      }
      output[variableName] = { certificateVersionId: generated.certificateVersionId, certificateFormatId: generated.certificateFormatId, format: generated.format, outputs };
    }
    return output;
  }
}

function stable(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`; return JSON.stringify(value); }

function assertManagedContext(context: PluginBindingV1['managedContext'] | undefined): void {
  if (!context) return;
  const unknownFields = Object.keys(context).filter((key) => key !== 'hostId' && key !== 'managedTargetId');
  if (unknownFields.length > 0) {
    throw new AppError('VALIDATION_FAILED', 'Managed Binding 只允许保存 Host 和 ManagedTarget 身份', { unknownFields });
  }
}
