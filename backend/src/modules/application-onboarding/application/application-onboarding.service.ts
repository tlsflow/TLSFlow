import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';
import { compareSemanticVersions, type UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import { PluginLocaleService } from '../../plugins/locales/plugin-locale.service.js';
import { ApplicationOnboardingRecipeLoader, type LoadedApplicationOnboardingRecipe } from '../recipe/index.js';
import { ApplicationOnboardingSessionRepository } from '../repository/application-onboarding-session.repository.js';
import type {
  ApplicationOnboardingSessionDto,
  CreateOnboardingSessionInput,
  OnboardingDeviceOptionDto,
  OnboardingPlatformBusinessMetadataDto,
  OnboardingPlatformDto,
  OnboardingTargetOptionDto,
  StateVersionInput,
} from '../dto/application-onboarding.dto.js';

export interface OnboardingExecutionPort {
  onboardDevice?: (tenantId: string, platformKey: string, pluginVersionId: string, values: Record<string, unknown>, actorId: string) => Promise<{ deviceId: string; assetId?: string }>;
  /** 校验已有设备属于当前租户且具备配方要求的插件能力。 */
  validateExistingDevice?: (tenantId: string, deviceId: string, session: ApplicationOnboardingSessionDto, recipe: LoadedApplicationOnboardingRecipe) => Promise<void>;
  listExistingDevices?: (tenantId: string, session: ApplicationOnboardingSessionDto, recipe: LoadedApplicationOnboardingRecipe) => Promise<OnboardingDeviceOptionDto[]>;
  testConnection?: (tenantId: string, session: ApplicationOnboardingSessionDto, recipe: LoadedApplicationOnboardingRecipe) => Promise<void>;
  discover?: (tenantId: string, session: ApplicationOnboardingSessionDto, recipe: LoadedApplicationOnboardingRecipe) => Promise<OnboardingTargetOptionDto[]>;
  /** 宿主只有在真正接入了直工作流发现/连接适配器时才暴露该平台。 */
  supportsDirectWorkflow?: (platformKey: string, recipe: LoadedApplicationOnboardingRecipe) => boolean | Promise<boolean>;
  /** 在证书进入 READY_TO_COMMIT 前复核租户、格式、状态和精确版本。 */
  validateCertificate?: (tenantId: string, certificateId: string, certificateVersionId: string, session: ApplicationOnboardingSessionDto, recipe: LoadedApplicationOnboardingRecipe) => Promise<void>;
}

export interface OnboardingCommitPort {
  commit: (tenantId: string, actorId: string, session: ApplicationOnboardingSessionDto, recipe: LoadedApplicationOnboardingRecipe) => Promise<Record<string, unknown>>;
}

export class ApplicationOnboardingService {
  private readonly locales = new PluginLocaleService();

  constructor(
    private readonly repository: ApplicationOnboardingSessionRepository,
    private readonly plugins: UnifiedPluginsApplicationService,
    private readonly loader = new ApplicationOnboardingRecipeLoader(),
    private readonly execution: OnboardingExecutionPort = {},
    private readonly commit?: OnboardingCommitPort,
  ) {}

  async listPlatforms(tenantId: string, locale = 'zh-CN'): Promise<OnboardingPlatformDto[]> {
    const versions = await this.plugins.listAccessibleVersions(tenantId);
    const result: OnboardingPlatformDto[] = [{
      platformKey: 'CUSTOM_MANUAL',
      source: 'CUSTOM_MANUAL',
      displayNameKey: 'applicationOnboarding.platforms.customManual',
      supportStatus: 'SUPPORTED',
    }];
    const byPlatform = new Map<string, OnboardingPlatformDto>();
    for (const version of versions) {
      if (version.status !== 'ENABLED' || !version.manifest.resources.onboarding) continue;
      try {
        for (const bundle of this.loadVersion(version)) {
          const current = byPlatform.get(bundle.recipe.platformKey);
          if (!current || preferPlatformVersion(bundle, version, current)) {
            const directSupported = bundle.recipe.supportStatus === 'SUPPORTED'
              && (bundle.recipe.deploymentMode !== 'DIRECT_WORKFLOW'
                || (this.execution.supportsDirectWorkflow ? await this.execution.supportsDirectWorkflow(bundle.recipe.platformKey, bundle) : false));
            byPlatform.set(bundle.recipe.platformKey, {
              platformKey: bundle.recipe.platformKey,
              source: 'PLUGIN',
              pluginVersionId: bundle.pluginVersionId,
              pluginId: bundle.pluginId,
              pluginVersion: bundle.pluginVersion,
              displayNameKey: bundle.recipe.displayNameKey,
              displayName: this.resolveDisplayName(version, bundle, locale),
              logoUrl: version.manifest.logoUrl,
              businessMetadata: this.resolveBusinessMetadata(version, bundle, locale),
              deploymentMode: bundle.recipe.deploymentMode,
              deviceSelection: bundle.recipe.deviceSelection,
              ...(bundle.recipe.newDeviceOnboarding ? { newDeviceOnboarding: bundle.recipe.newDeviceOnboarding } : {}),
              supportStatus: directSupported ? 'SUPPORTED' : 'IN_REVIEW',
              updatedAt: version.updatedAt,
            });
          }
        }
      } catch {
        // 无效配方不进入普通用户目录，由插件发布门禁报告错误。
      }
    }
    return [...result, ...byPlatform.values()];
  }

  async createSession(tenantId: string, actorId: string, input: CreateOnboardingSessionInput): Promise<ApplicationOnboardingSessionDto> {
    const existing = await this.repository.findByIdempotencyKey(tenantId, input.idempotencyKey);
    if (existing) return existing;
    const platform = (await this.listPlatforms(tenantId)).find((item) => item.platformKey === input.platformKey && item.source === 'PLUGIN');
    if (!platform?.pluginVersionId || platform.supportStatus !== 'SUPPORTED') {
      throw new AppError('VALIDATION_FAILED', '平台当前不可用于插件接入向导', { platformKey: input.platformKey, supportStatus: platform?.supportStatus });
    }
    const version = await this.plugins.getVersionForTenant(tenantId, platform.pluginVersionId);
    const recipe = this.loadVersion(version).find((item) => item.recipe.platformKey === input.platformKey);
    if (!recipe) throw new AppError('RESOURCE_VERSION_CONFLICT', '平台配方已不存在或已变化', { platformKey: input.platformKey, pluginVersionId: platform.pluginVersionId });
    const now = new Date();
    const session: ApplicationOnboardingSessionDto = {
      id: newId('onboard'), tenantId, actorId, platformKey: input.platformKey,
      pluginVersionId: recipe.pluginVersionId, recipeHash: recipe.recipeHash,
      // 新配方统一先选择真实设备；保留 NONE 以兼容已发布的无设备直工作流会话。
      state: recipe.recipe.deviceSelection === 'NONE' ? 'CONNECTION_TESTING' : 'PLATFORM_SELECTED', stateVersion: 1, deploymentMode: recipe.recipe.deploymentMode,
      inputSnapshot: {}, targets: [], idempotencyKey: input.idempotencyKey,
      createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    };
    return this.repository.create(session);
  }

  async getSession(tenantId: string, id: string): Promise<ApplicationOnboardingSessionDto> {
    const session = await this.repository.get(tenantId, id);
    if (!session) throw new AppError('RESOURCE_NOT_FOUND', '接入会话不存在', { id });
    if (new Date(session.expiresAt).getTime() < Date.now() && !['PLAN_CREATED', 'CANCELLED', 'FAILED'].includes(session.state)) {
      const expired = await this.repository.update(tenantId, id, session.stateVersion, { state: 'FAILED', lastErrorCode: 'ONBOARDING_SESSION_EXPIRED', lastErrorDetail: {} });
      return expired ?? { ...session, state: 'FAILED' };
    }
    return session;
  }

  async selectResource(tenantId: string, id: string, input: StateVersionInput & { mode: 'EXISTING_DEVICE' | 'NEW_DEVICE'; deviceId?: string; values?: Record<string, unknown> }): Promise<ApplicationOnboardingSessionDto> {
    const session = await this.getSession(tenantId, id);
    const recipe = await this.recipeForSession(tenantId, session);
    if (input.mode === 'EXISTING_DEVICE') {
      const deviceId = input.deviceId?.trim();
      if (!deviceId) throw new AppError('VALIDATION_FAILED', '选择已有设备时必须提供设备 ID', { code: 'ONBOARDING_DEVICE_REQUIRED' });
      if (!isResourceSelectionState(session.state)) {
        if (session.deviceId === deviceId && hasSelectedResource(session.state)) return session;
        throw invalidState(session, '不能重复选择设备来源');
      }
      if (!this.execution.validateExistingDevice) {
        throw new AppError('SYSTEM_INTERNAL_ERROR', '已有设备校验服务未接入', { code: 'ONBOARDING_DEVICE_VALIDATION_UNAVAILABLE' });
      }
      await this.execution.validateExistingDevice(tenantId, deviceId, session, recipe);
      const updated = await this.repository.update(tenantId, id, input.expectedStateVersion, {
        state: 'CONNECTION_TESTING', deviceId, inputSnapshot: sanitizeInput(input.values ?? {}),
      });
      if (!updated) throw versionConflict();
      return updated;
    }
    if (!isResourceSelectionState(session.state)) throw invalidState(session, '不能重复选择设备来源');
    if (recipe.recipe.deviceSelection !== 'EXISTING_OR_NEW') throw new AppError('VALIDATION_FAILED', '该平台不支持新增设备', { code: 'ONBOARDING_NEW_DEVICE_NOT_ALLOWED' });
    if (recipe.recipe.deploymentMode === 'DIRECT_WORKFLOW') {
      throw new AppError('VALIDATION_FAILED', '直接工作流的新增设备必须通过统一设备向导完成', {
        code: 'ONBOARDING_DEVICE_WIZARD_REQUIRED',
      });
    }
    if (!this.execution.onboardDevice) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', '新增设备接入服务未接入', { code: 'ONBOARDING_DEVICE_ONBOARDING_UNAVAILABLE' });
    }
    const updated = await this.repository.update(tenantId, id, input.expectedStateVersion, {
      state: 'DEVICE_ONBOARDING', deviceId: null, inputSnapshot: sanitizeInput(input.values ?? {}),
    });
    if (!updated) throw versionConflict();
    try {
      const created = await this.execution.onboardDevice(tenantId, recipe.recipe.platformKey, recipe.pluginVersionId, input.values ?? {}, session.actorId);
      if (!created.deviceId) throw new AppError('SYSTEM_INTERNAL_ERROR', '设备接入未返回设备 ID', { code: 'ONBOARDING_DEVICE_ID_MISSING' });
      const onboarded = await this.repository.update(tenantId, id, updated.stateVersion, { deviceId: created.deviceId, assetId: created.assetId ?? null, state: 'CONNECTION_TESTING' });
      if (!onboarded) throw versionConflict();
      return onboarded;
    } catch (error) {
      await this.repository.update(tenantId, id, updated.stateVersion, { state: 'FAILED', lastErrorCode: 'ONBOARDING_DEVICE_ONBOARDING_FAILED', lastErrorDetail: errorDetail(error) });
      throw error;
    }
  }

  async test(tenantId: string, id: string, input: StateVersionInput): Promise<ApplicationOnboardingSessionDto> {
    const session = await this.getSession(tenantId, id);
    const recipe = await this.recipeForSession(tenantId, session);
    if (!['CONNECTION_TESTING', 'DEVICE_ONBOARDING'].includes(session.state)) throw invalidState(session, '当前阶段不能测试连接');
    if (recipe.recipe.deviceSelection !== 'NONE' && !session.deviceId) {
      throw new AppError('VALIDATION_FAILED', '连接测试缺少设备 ID', { code: 'ONBOARDING_DEVICE_REQUIRED' });
    }
    if (!this.execution.testConnection) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', '连接测试服务未接入', { code: 'ONBOARDING_CONNECTION_TEST_UNAVAILABLE' });
    }
    const testing = await this.repository.update(tenantId, id, input.expectedStateVersion, { state: 'CONNECTION_TESTING' });
    if (!testing) throw versionConflict();
    try {
      await this.execution.testConnection(tenantId, testing, recipe);
      const next = await this.repository.update(tenantId, id, testing.stateVersion, { state: 'DISCOVERING' });
      if (!next) throw versionConflict();
      return next;
    } catch (error) {
      await this.repository.update(tenantId, id, testing.stateVersion, { state: 'FAILED', lastErrorCode: 'ONBOARDING_CONNECTION_FAILED', lastErrorDetail: errorDetail(error) });
      throw error;
    }
  }

  async discover(tenantId: string, id: string, input: StateVersionInput): Promise<ApplicationOnboardingSessionDto> {
    const session = await this.getSession(tenantId, id);
    const recipe = await this.recipeForSession(tenantId, session);
    if (!['DISCOVERING', 'TARGET_SELECTION_REQUIRED'].includes(session.state)) throw invalidState(session, '当前阶段不能扫描站点');
    if (recipe.recipe.deviceSelection !== 'NONE' && !session.deviceId) {
      throw new AppError('VALIDATION_FAILED', '扫描站点缺少设备 ID', { code: 'ONBOARDING_DEVICE_REQUIRED' });
    }
    if (!this.execution.discover) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', '站点发现服务未接入', { code: 'ONBOARDING_DISCOVERY_UNAVAILABLE' });
    }
    try {
      const options = await this.execution.discover(tenantId, session, recipe);
      const updated = await this.repository.update(tenantId, id, input.expectedStateVersion, { state: 'TARGET_SELECTION_REQUIRED', targets: options });
      if (!updated) throw versionConflict();
      return updated;
    } catch (error) {
      // 发现失败必须关闭会话，不能留下可继续提交的半成品状态。
      const current = await this.repository.get(tenantId, id);
      if (current) await this.repository.update(tenantId, id, current.stateVersion, { state: 'FAILED', lastErrorCode: 'ONBOARDING_DISCOVERY_FAILED', lastErrorDetail: errorDetail(error) });
      throw error;
    }
  }

  async targets(tenantId: string, id: string): Promise<OnboardingTargetOptionDto[]> {
    return (await this.getSession(tenantId, id)).targets;
  }

  async devices(tenantId: string, id: string): Promise<OnboardingDeviceOptionDto[]> {
    const session = await this.getSession(tenantId, id);
    const recipe = await this.recipeForSession(tenantId, session);
    if (!this.execution.listExistingDevices) return [];
    return this.execution.listExistingDevices(tenantId, session, recipe);
  }

  async selectCertificate(tenantId: string, id: string, input: StateVersionInput & { certificateId: string; certificateVersionId: string }): Promise<ApplicationOnboardingSessionDto> {
    const session = await this.getSession(tenantId, id);
    const recipe = await this.recipeForSession(tenantId, session);
    if (session.state !== 'CERTIFICATE_SELECTION_REQUIRED') throw invalidState(session, '当前阶段不能选择证书');
    if (!session.targetId || !session.targetFingerprint) throw new AppError('VALIDATION_FAILED', '请先选择业务站点', { code: 'ONBOARDING_TARGET_REQUIRED' });
    const certificateId = input.certificateId?.trim();
    const certificateVersionId = input.certificateVersionId?.trim();
    if (!certificateId || !certificateVersionId) throw new AppError('VALIDATION_FAILED', '必须选择证书资产和精确版本', { code: 'ONBOARDING_CERTIFICATE_REQUIRED' });
    if (this.execution.validateCertificate) await this.execution.validateCertificate(tenantId, certificateId, certificateVersionId, session, recipe);
    const updated = await this.repository.update(tenantId, id, input.expectedStateVersion, {
      state: 'READY_TO_COMMIT', certificateId, certificateVersionId,
      inputSnapshot: { ...session.inputSnapshot, certificateId, certificateVersionId },
    });
    if (!updated) throw versionConflict();
    return updated;
  }

  async selectTarget(tenantId: string, id: string, input: StateVersionInput & { managedTargetId: string; configFingerprint: string }): Promise<ApplicationOnboardingSessionDto> {
    const session = await this.getSession(tenantId, id);
    const target = session.targets.find((item) => item.managedTargetId === input.managedTargetId && item.configFingerprint === input.configFingerprint);
    if (!target || !target.selectable) throw new AppError('VALIDATION_FAILED', '站点选择已失效，请重新扫描');
    const inputSnapshot = {
      ...session.inputSnapshot,
      ...(target.endpoint ? { endpoint: target.endpoint } : {}),
      displayName: target.displayName,
    };
    const updated = await this.repository.update(tenantId, id, input.expectedStateVersion, {
      state: 'CERTIFICATE_SELECTION_REQUIRED',
      targetId: target.managedTargetId,
      targetFingerprint: target.configFingerprint,
      inputSnapshot,
    });
    if (!updated) throw versionConflict();
    return updated;
  }

  async complete(tenantId: string, id: string, input: StateVersionInput & { idempotencyKey: string }): Promise<ApplicationOnboardingSessionDto> {
    const session = await this.getSession(tenantId, id);
    if (session.state === 'PLAN_CREATED') return session;
    if (session.state !== 'READY_TO_COMMIT') throw invalidState(session, '接入会话尚未完成必要选择');
    const recipe = await this.recipeForSession(tenantId, session);
    if (!session.targetId || !session.targetFingerprint) throw new AppError('VALIDATION_FAILED', '向导缺少已复核的目标站点', { code: 'ONBOARDING_TARGET_REQUIRED' });
    if (!session.certificateId || !session.certificateVersionId) throw new AppError('VALIDATION_FAILED', '向导缺少已复核的证书版本', { code: 'ONBOARDING_CERTIFICATE_REQUIRED' });
    if (!this.commit) throw new AppError('SYSTEM_INTERNAL_ERROR', '应用接入提交服务未接入', { code: 'ONBOARDING_COMMIT_UNAVAILABLE' });
    const committing = await this.repository.update(tenantId, id, input.expectedStateVersion, { state: 'COMMITTING' });
    if (!committing) throw versionConflict();
    try {
      const result = await this.commit.commit(tenantId, session.actorId, committing, recipe);
      const completed = await this.repository.update(tenantId, id, committing.stateVersion, { state: 'PLAN_CREATED', result });
      if (!completed) throw versionConflict();
      return completed;
    } catch (error) {
      const detail = { message: error instanceof Error ? error.message : String(error) };
      await this.repository.update(tenantId, id, committing.stateVersion, { state: 'FAILED', lastErrorCode: 'ONBOARDING_COMMIT_FAILED', lastErrorDetail: detail });
      throw error;
    }
  }

  async cancel(tenantId: string, id: string, input: StateVersionInput): Promise<ApplicationOnboardingSessionDto> {
    const session = await this.getSession(tenantId, id);
    if (['COMMITTING', 'PLAN_CREATED'].includes(session.state)) throw invalidState(session, '当前会话不可取消');
    const updated = await this.repository.update(tenantId, id, input.expectedStateVersion, { state: 'CANCELLED' });
    if (!updated) throw versionConflict();
    return updated;
  }

  private async recipeForSession(tenantId: string, session: ApplicationOnboardingSessionDto): Promise<LoadedApplicationOnboardingRecipe> {
    if (!session.pluginVersionId) throw new AppError('VALIDATION_FAILED', '会话未绑定插件版本');
    const recipes = this.loadVersion(await this.plugins.getVersionForTenant(tenantId, session.pluginVersionId));
    const recipe = recipes.find((item) => item.recipeHash === session.recipeHash);
    if (!recipe) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '接入会话绑定的插件配方已不存在或已变化', {
        pluginVersionId: session.pluginVersionId,
        recipeHash: session.recipeHash,
      });
    }
    return recipe;
  }

  private loadVersion(version: UnifiedPluginVersionRecord): LoadedApplicationOnboardingRecipe[] {
    return this.loader.loadAll(version);
  }

  private resolveDisplayName(version: UnifiedPluginVersionRecord, recipe: LoadedApplicationOnboardingRecipe, locale: string): string | undefined {
    const bundle = this.locales.validate(version.manifest, version.resources, [recipe.recipe.displayNameKey]);
    return bundle ? this.locales.resolve(bundle, locale, recipe.recipe.displayNameKey) : undefined;
  }

  private resolveBusinessMetadata(
    version: UnifiedPluginVersionRecord,
    recipe: LoadedApplicationOnboardingRecipe,
    locale: string,
  ): OnboardingPlatformBusinessMetadataDto | undefined {
    const metadata = recipe.recipe.platformMetadata;
    if (!metadata) return undefined;
    const referencedKeys = [...metadata.compatibilityKeys, ...metadata.requiredInformationKeys];
    const bundle = this.locales.validate(version.manifest, version.resources, referencedKeys);
    if (!bundle) return undefined;
    const resolveAll = (keys: string[]): string[] | undefined => {
      const values = keys.map((key) => this.locales.resolve(bundle, locale, key));
      return values.every((value): value is string => value !== undefined) ? values : undefined;
    };
    const compatibleVersions = resolveAll(metadata.compatibilityKeys);
    const requiredInformation = resolveAll(metadata.requiredInformationKeys);
    if (!compatibleVersions || !requiredInformation) return undefined;
    // 页面展示的是固定 PluginVersion 的发布版本；配方合同版本不能伪装成插件发布版本。
    return { capabilityVersion: recipe.pluginVersion, compatibleVersions, requiredInformation };
  }
}

/**
 * 插件版本是不可变发布物，目录必须优先选择更高的语义版本。
 * updatedAt 只用于同一版本的重复可见记录兜底，不能让旧版本因后续操作覆盖新版本。
 */
function preferPlatformVersion(
  candidate: LoadedApplicationOnboardingRecipe,
  candidateVersion: UnifiedPluginVersionRecord,
  current: OnboardingPlatformDto,
): boolean {
  const versionOrder = compareSemanticVersions(candidate.pluginVersion, current.pluginVersion ?? '0.0.0');
  if (versionOrder !== 0) return versionOrder > 0;
  return candidateVersion.updatedAt > (current.updatedAt ?? '');
}

function sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (/pass(word)?|secret|token|private.?key/i.test(key)) continue;
    if (typeof value === 'string' && value.length > 512) output[key] = value.slice(0, 512);
    else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) output[key] = value;
  }
  return output;
}

function errorDetail(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) {
    return { code: error.errorCode };
  }
  return { code: 'UPSTREAM_ERROR' };
}

function isResourceSelectionState(state: ApplicationOnboardingSessionDto['state']): boolean {
  return state === 'PLATFORM_SELECTED' || state === 'RESOURCE_SELECTION_REQUIRED';
}

function hasSelectedResource(state: ApplicationOnboardingSessionDto['state']): boolean {
  return [
    'DEVICE_ONBOARDING',
    'CONNECTION_TESTING',
    'DISCOVERING',
    'TARGET_SELECTION_REQUIRED',
    'CERTIFICATE_SELECTION_REQUIRED',
    'READY_TO_COMMIT',
    'COMMITTING',
    'PLAN_CREATED',
  ].includes(state);
}

function invalidState(session: ApplicationOnboardingSessionDto, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, { code: 'ONBOARDING_INVALID_STATE', state: session.state, stateVersion: session.stateVersion });
}

function versionConflict(): AppError {
  return new AppError('CONFLICT', '接入会话已被其他操作更新，请刷新后重试', { code: 'ONBOARDING_SESSION_VERSION_CONFLICT' });
}
