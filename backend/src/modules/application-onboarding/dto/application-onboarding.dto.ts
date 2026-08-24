import type {
  ApplicationOnboardingNewDeviceOnboarding,
  ApplicationOnboardingDeploymentDefaultsV1,
  ApplicationOnboardingRecipeV1,
} from '../recipe/application-onboarding-recipe.dto.js';
import type { InputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';

export type OnboardingSessionState =
  | 'CREATED'
  | 'PLATFORM_SELECTED'
  | 'RESOURCE_SELECTION_REQUIRED'
  | 'DEVICE_INPUT_REQUIRED'
  | 'DEVICE_ONBOARDING'
  | 'WAITING_AGENT'
  | 'CONNECTION_TESTING'
  | 'DISCOVERING'
  | 'TARGET_SELECTION_REQUIRED'
  | 'CERTIFICATE_SELECTION_REQUIRED'
  | 'READY_TO_COMMIT'
  | 'COMMITTING'
  | 'PLAN_CREATED'
  | 'FAILED'
  | 'CANCELLED';

/** 平台选择卡片使用的业务接入说明，不暴露插件包实现细节。 */
export interface OnboardingPlatformBusinessMetadataDto {
  capabilityVersion: string;
  compatibleVersions: string[];
  requiredInformation: string[];
}

export interface OnboardingPlatformDto {
  platformKey: string;
  source: 'PLUGIN' | 'CUSTOM_MANUAL';
  pluginVersionId?: string;
  pluginId?: string;
  pluginVersion?: string;
  displayNameKey: string;
  /** 插件 Locale 解析后的展示名称；宿主无需把插件 key 写入自身 i18n。 */
  displayName?: string;
  /** 由固定插件 Manifest 声明的同源展示图标；前端不得按平台键猜测厂商资源。 */
  logoUrl?: string;
  /** 由插件配方声明并经插件 Locale 解析的业务接入信息。 */
  businessMetadata?: OnboardingPlatformBusinessMetadataDto;
  deploymentMode?: ApplicationOnboardingRecipeV1['deploymentMode'];
  deviceSelection?: ApplicationOnboardingRecipeV1['deviceSelection'];
  /** 插件声明的统一设备向导预选入口。 */
  newDeviceOnboarding?: ApplicationOnboardingNewDeviceOnboarding;
  supportStatus: 'SUPPORTED' | 'PREVIEW' | 'IN_REVIEW';
  /** 插件配方声明的平台接受的证书格式（如 PEM/PFX），向导据此过滤证书版本选项。 */
  acceptedCertificateFormats?: string[];
  /** 插件声明的通用部署默认值，宿主只负责投影、保存和校验，不解释字段名称。 */
  deploymentDefaults?: ApplicationOnboardingDeploymentDefaultsV1;
  /** 仅供宿主选择同一平台最新插件版本，不作为用户配置字段。 */
  updatedAt?: string;
}

export interface OnboardingTargetOptionDto {
  managedTargetId: string;
  targetType: string;
  displayName: string;
  endpoint?: { host?: string; port?: number; protocol?: string };
  certificateStatus?: string;
  configFingerprint: string;
  selectable: boolean;
  reasonCode?: string;
}

/** 向导只展示已通过平台和健康初筛的已有设备，不暴露内部插件绑定信息。 */
export interface OnboardingDeviceOptionDto {
  deviceId: string;
  displayName: string;
  address?: string;
  health: string;
  selectable: boolean;
  reasonCode?: string;
}

export interface ApplicationOnboardingSessionDto {
  id: string;
  tenantId: string;
  actorId: string;
  platformKey: string;
  pluginVersionId?: string;
  recipeHash?: string;
  state: OnboardingSessionState;
  stateVersion: number;
  deploymentMode?: ApplicationOnboardingRecipeV1['deploymentMode'];
  deviceId?: string;
  assetId?: string;
  discoverySnapshotId?: string;
  targetId?: string;
  targetFingerprint?: string;
  certificateId?: string;
  certificateVersionId?: string;
  inputSnapshot: Record<string, unknown>;
  targets: OnboardingTargetOptionDto[];
  result?: Record<string, unknown>;
  lastErrorCode?: string;
  lastErrorDetail?: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface CreateOnboardingSessionInput {
  platformKey: string;
  idempotencyKey: string;
}

export interface StateVersionInput {
  expectedStateVersion: number;
  idempotencyKey?: string;
}

export type OnboardingInputBindings = InputBindingsV1;
