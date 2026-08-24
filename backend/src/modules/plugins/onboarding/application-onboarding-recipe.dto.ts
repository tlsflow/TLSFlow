import type { UnifiedPluginManifestV1 } from '../dto/unified-plugins.dto.js';

/** 接入配方协议版本。宿主只实现这个固定协议，不允许插件声明新的宿主步骤。 */
export const applicationOnboardingProtocol = 'gcac.application-onboarding/v1' as const;
/** 宿主编排模块沿用的命名，保持插件边界导出的合同名称一致。 */
export const applicationOnboardingRecipeProtocol = applicationOnboardingProtocol;

export type ApplicationOnboardingDeploymentMode = 'MANAGED_TARGET' | 'DIRECT_WORKFLOW';
export type ApplicationOnboardingDeviceSelection = 'EXISTING_OR_NEW' | 'EXISTING_ONLY' | 'NONE';
export type ApplicationOnboardingExecutionSource = 'PLUGIN' | 'WORKFLOW';

/**
 * 插件声明的新建设备入口。宿主只负责打开统一设备向导，不得按应用平台名称猜测设备接入方式。
 */
export type ApplicationOnboardingAgentInstallOnboarding =
  | { kind: 'AGENT_INSTALL'; platformKey: string }
  | { kind: 'AGENT_INSTALL'; platformKeys: string[] };

export type ApplicationOnboardingNewDeviceOnboarding =
  | ApplicationOnboardingAgentInstallOnboarding
  | { kind: 'PLUGIN_MANAGED'; pluginId: string };
/**
 * 平台可接入状态必须由插件配方声明。宿主只执行通用门禁，不能按厂商或产品名特判。
 */
export type ApplicationOnboardingSupportStatus = 'SUPPORTED' | 'IN_REVIEW';

/**
 * 平台选择页的业务接入说明。文本通过插件 Locale 声明，宿主不保留厂商或产品特判。
 */
export interface ApplicationOnboardingPlatformMetadata {
  /** 插件对外承诺的接入能力版本，不等同于插件包版本。 */
  capabilityVersion: string;
  /** 当前插件版本已验证的平台/产品版本说明 Locale key。 */
  compatibilityKeys: string[];
  /** 用户开始接入前必须准备的信息 Locale key。 */
  requiredInformationKeys: string[];
}

export interface ApplicationOnboardingRecipeV1 {
  protocol: typeof applicationOnboardingProtocol;
  platformKey: string;
  displayNameKey: string;
  /** 可选是为了兼容已发布的旧插件；新插件应声明完整的业务接入说明。 */
  platformMetadata?: ApplicationOnboardingPlatformMetadata;
  supportStatus: ApplicationOnboardingSupportStatus;
  deploymentMode: ApplicationOnboardingDeploymentMode;
  deviceResourceType?: string;
  deviceSelection: ApplicationOnboardingDeviceSelection;
  /**
   * 允许新增设备时，指向统一设备向导内的确定入口。
   * 未声明时为兼容已发布插件，只提供已有设备选择。
   */
  newDeviceOnboarding?: ApplicationOnboardingNewDeviceOnboarding;
  forms: {
    device?: string;
    advanced?: string;
  };
  capabilities: {
    connectionTest: string;
    identity?: string;
    discovery: string;
    workflowExecution?: string;
  };
  targetProjection: {
    targetType: string;
    displayFields: string[];
    identityFields: string[];
    selectableWhen: string;
  };
  certificate: {
    /** 宿主标准证书格式码（PEM/PFX/JKS/DER/P7B，见 shared/enums CertificateFormats）；配方校验强制只能从中选择，与证书版本产物配置一一对应。 */
    acceptedFormats: string[];
    requiredArtifacts: string[];
    defaultVersion: 'LATEST_VALID';
  };
  commit: {
    executionSource: ApplicationOnboardingExecutionSource;
    inputContract: string;
  };
}

/** 已加载且绑定到固定插件版本的接入配方。 */
export interface ApplicationOnboardingRecipeBundle {
  recipe: ApplicationOnboardingRecipeV1;
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  resourcePath: string;
  recipeHash: string;
}

/** Loader 的兼容名称，方便 application-onboarding 宿主模块按领域命名引用。 */
export type LoadedApplicationOnboardingRecipe = ApplicationOnboardingRecipeBundle;

export interface ApplicationOnboardingRecipeValidationContext {
  manifest: UnifiedPluginManifestV1;
}
