import { AppError } from '../../../common/errors/app-error.js';
import type { DeploymentDriverKind, ExecutionLocation, ResolvedManagedTargetContext } from '../../assets/application/managed-target-context.resolver.js';

export interface DeploymentDriverStepDraft {
  stage: 'PRECHECK' | 'BACKUP' | 'DEPLOY' | 'VERIFY' | 'ROLLBACK';
  executorType: 'AGENT' | 'CURL' | 'WORKFLOW';
  operation: string;
  input: Record<string, unknown>;
}

export interface DeploymentDriverSecretRequirement {
  purpose: string;
  secretRef: string;
  visibleAt: ExecutionLocation;
}

export interface DeploymentDriver {
  kind: DeploymentDriverKind;
  executionLocation: ExecutionLocation;
  supports(context: ResolvedManagedTargetContext): boolean;
  precheck(context: ResolvedManagedTargetContext): DeploymentDriverStepDraft[];
  buildDeployment(context: ResolvedManagedTargetContext): DeploymentDriverStepDraft[];
  buildRollback(context: ResolvedManagedTargetContext): DeploymentDriverStepDraft[];
  requiredSecrets(context: ResolvedManagedTargetContext): DeploymentDriverSecretRequirement[];
}

export class DeploymentDriverRegistry {
  private readonly drivers = new Map<DeploymentDriverKind, DeploymentDriver>();

  register(driver: DeploymentDriver): this {
    if (this.drivers.has(driver.kind)) throw driverError('部署驱动重复注册', { driverKind: driver.kind });
    this.drivers.set(driver.kind, driver);
    return this;
  }

  resolve(context: ResolvedManagedTargetContext): DeploymentDriver {
    const driver = this.drivers.get(context.driverKind);
    if (!driver) throw driverError('受管目标没有可用部署驱动', { driverKind: context.driverKind });
    if (driver.executionLocation !== context.executionLocation) {
      throw driverError('部署驱动执行位置与受管目标不一致', {
        driverKind: driver.kind,
        driverLocation: driver.executionLocation,
        targetLocation: context.executionLocation,
      });
    }
    if (!driver.supports(context)) throw driverError('部署驱动不支持当前受管目标', { driverKind: driver.kind, providerType: context.providerType });
    return driver;
  }
}

export function createBuiltinDeploymentDriverRegistry(): DeploymentDriverRegistry {
  return new DeploymentDriverRegistry()
    .register(new BasicDeploymentDriver('AGENT_NATIVE', 'AGENT', ['IIS', 'NGINX', 'APACHE', 'TOMCAT', 'WINDOWS_CERT_STORE']))
    .register(new BasicDeploymentDriver('AGENT_PLUGIN', 'AGENT'))
    .register(new DevicePluginDeploymentDriver());
}

class BasicDeploymentDriver implements DeploymentDriver {
  constructor(
    readonly kind: DeploymentDriverKind,
    readonly executionLocation: ExecutionLocation,
    private readonly providers?: string[],
  ) {}

  supports(context: ResolvedManagedTargetContext): boolean {
    return !this.providers || this.providers.includes(context.providerType);
  }

  precheck(context: ResolvedManagedTargetContext): DeploymentDriverStepDraft[] {
    return [step('PRECHECK', this.executionLocation === 'AGENT' ? 'AGENT' : 'WORKFLOW', 'managed_target.precheck', context)];
  }

  buildDeployment(context: ResolvedManagedTargetContext): DeploymentDriverStepDraft[] {
    return [step('DEPLOY', this.executionLocation === 'AGENT' ? 'AGENT' : 'WORKFLOW', 'managed_target.deploy', context)];
  }

  buildRollback(context: ResolvedManagedTargetContext): DeploymentDriverStepDraft[] {
    return [step('ROLLBACK', this.executionLocation === 'AGENT' ? 'AGENT' : 'WORKFLOW', 'managed_target.rollback', context)];
  }

  requiredSecrets(_context: ResolvedManagedTargetContext): DeploymentDriverSecretRequirement[] {
    return [];
  }
}

class DevicePluginDeploymentDriver implements DeploymentDriver {
  readonly kind = 'DEVICE_PLUGIN' as const;
  readonly executionLocation = 'CONTROL_PLANE' as const;

  supports(context: ResolvedManagedTargetContext): boolean {
    return context.deviceAsset?.pluginBindingId !== undefined && context.executionLocation === this.executionLocation;
  }

  precheck(context: ResolvedManagedTargetContext): DeploymentDriverStepDraft[] {
    return [step('PRECHECK', 'WORKFLOW', 'managed_target.precheck', context)];
  }

  buildDeployment(context: ResolvedManagedTargetContext): DeploymentDriverStepDraft[] {
    return [step('DEPLOY', 'WORKFLOW', 'managed_target.deploy', context)];
  }

  buildRollback(context: ResolvedManagedTargetContext): DeploymentDriverStepDraft[] {
    return [step('ROLLBACK', 'WORKFLOW', 'managed_target.rollback', context)];
  }

  requiredSecrets(_context: ResolvedManagedTargetContext): DeploymentDriverSecretRequirement[] {
    return [];
  }
}

function step(stage: DeploymentDriverStepDraft['stage'], executorType: DeploymentDriverStepDraft['executorType'], operation: string, context: ResolvedManagedTargetContext): DeploymentDriverStepDraft {
  return { stage, executorType, operation, input: { managedTargetId: context.managedTarget.id, providerType: context.providerType } };
}

function driverError(message: string, detail: Record<string, unknown>): AppError {
  return new AppError('VALIDATION_FAILED', message, { code: 'DEPLOYMENT_DRIVER_INVALID', ...detail });
}
