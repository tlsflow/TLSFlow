import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { Provider } from '../application/provider.interface.js';
import type { DeploymentDraftBundle, DeploymentStepDraft, DiscoveryExecutionContext, DiscoveryResult, ProviderDescriptor } from '../dto/providers.dto.js';

export type TemplateVariableType = 'string' | 'path' | 'number' | 'boolean' | 'secret' | 'certificate' | 'artifact';
export type CustomVerificationType = 'manual' | 'tls' | 'http' | 'command' | 'file';
export type CustomDeploymentMode = 'manual-only' | 'L4' | 'L5';
export type ManualBindingStatus = 'draft' | 'pending_acceptance' | 'accepted' | 'rejected' | 'disabled';
export type CustomTemplateStatus = 'draft' | 'published' | 'deprecated' | 'disabled';
export type CustomStepPhase = 'precheck' | 'backup' | 'install' | 'restart' | 'verify' | 'rollback';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SecretRef {
  secretRef: string;
}

export interface TemplateVariable {
  name: string;
  type: TemplateVariableType;
  required: boolean;
  defaultValue?: unknown;
  allowedPattern?: string;
  description?: string;
  sensitive: boolean;
}

export interface CustomVerificationStrategy {
  type: CustomVerificationType;
  target: Record<string, unknown>;
  assertions: Array<Record<string, unknown>>;
  timeoutSeconds: number;
  requiredCapabilities: string[];
  manual?: boolean;
}

export interface CustomCommandDefinition {
  phase: CustomStepPhase;
  name: string;
  shell: 'sh' | 'bash' | 'cmd' | 'powershell' | 'none';
  commandTemplate: string;
  workingDirectory?: string;
  timeoutSeconds: number;
  expectedExitCodes: number[];
  requiredCapabilities: string[];
  riskLevel: RiskLevel;
}

export interface CustomFileRenderDefinition {
  name: string;
  destinationPathTemplate: string;
  contentTemplate: string;
  requiredCapabilities: string[];
  riskLevel: RiskLevel;
}

export interface CustomHttpPlanDefinition {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  urlTemplate: string;
  bodyTemplate?: string;
  headers?: Record<string, string>;
  requiredCapabilities: string[];
  riskLevel: RiskLevel;
}

export interface CustomProviderTemplate {
  id: string;
  name: string;
  version: string;
  description?: string;
  serviceType: string;
  platforms: string[];
  variables: TemplateVariable[];
  paths: {
    certificatePath?: string;
    privateKeyPath?: string;
    keystorePath?: string;
    backupPath?: string;
    configPath?: string;
  };
  commands: CustomCommandDefinition[];
  files?: CustomFileRenderDefinition[];
  httpPlans?: CustomHttpPlanDefinition[];
  verification: CustomVerificationStrategy[];
  rollback?: CustomCommandDefinition[];
  riskPolicy: {
    allowAutoDeploy: boolean;
    deploymentMode: CustomDeploymentMode;
  };
  status: CustomTemplateStatus;
}

export interface ManualBindingAcceptance {
  evidenceRef: string;
  operator: string;
  auditRef: string;
  observedFingerprint?: string;
  status: 'pending' | 'accepted' | 'rejected';
  acceptedAt?: string;
}

export interface ManualBinding {
  id: string;
  hostId: string;
  hostname: string;
  serviceName: string;
  serviceType: string;
  templateId?: string;
  templateVersion?: string;
  certificateFormat: 'pem' | 'pfx' | 'jks' | 'pkcs12' | 'der';
  certificatePath?: string;
  privateKeyPath?: string;
  keystorePath?: string;
  keystorePasswordRef?: string;
  listenHost?: string;
  listenPort?: number;
  domains: string[];
  deploymentPolicy: {
    mode: CustomDeploymentMode;
    allowAutoDeploy: boolean;
    requiresManualApproval: boolean;
  };
  verificationPolicy: CustomVerificationStrategy[];
  acceptance?: ManualBindingAcceptance;
  riskLevel: RiskLevel;
  status: ManualBindingStatus;
  createdBy: string;
  updatedAt: string;
  renderedPlan?: {
    commands: RenderedCommandPlan[];
    files: RenderedFilePlan[];
    httpPlans: RenderedHttpPlan[];
    backupPath?: string;
    rollback?: RenderedCommandPlan[];
  };
}

export interface RenderedCommandPlan {
  phase: CustomStepPhase;
  name: string;
  shell: CustomCommandDefinition['shell'];
  command: string;
  workingDirectory?: string;
  timeoutSeconds: number;
  expectedExitCodes: number[];
  requiredCapabilities: string[];
  riskLevel: RiskLevel;
}

export interface RenderedFilePlan {
  name: string;
  destinationPath: string;
  content: string;
  requiredCapabilities: string[];
  riskLevel: RiskLevel;
}

export interface RenderedHttpPlan {
  name: string;
  method: CustomHttpPlanDefinition['method'];
  url: string;
  body?: string;
  headers: Record<string, string>;
  requiredCapabilities: string[];
  riskLevel: RiskLevel;
}

export interface RenderedCustomProvider {
  binding: ManualBinding;
  variableSnapshot: Record<string, unknown>;
}

export interface CustomRiskNotice {
  code: 'missing_verification' | 'manual_capability' | 'plaintext_secret' | 'no_rollback' | 'dangerous_command';
  level: RiskLevel;
  message: string;
  fieldPath?: string;
}

type RenderValues = Record<string, unknown>;

export class TemplateRenderService {
  render(template: CustomProviderTemplate, values: RenderValues, bindingSeed: Omit<ManualBinding, 'certificatePath' | 'privateKeyPath' | 'keystorePath' | 'keystorePasswordRef' | 'verificationPolicy' | 'riskLevel' | 'status' | 'updatedAt' | 'renderedPlan' | 'deploymentPolicy'> & Partial<Pick<ManualBinding, 'deploymentPolicy' | 'status'>>): RenderedCustomProvider {
    validateTemplate(template);
    const variables = resolveVariables(template.variables, values);
    const renderText = (templateText: string | undefined) => templateText === undefined ? undefined : renderTemplateText(templateText, template.variables, variables);
    const commands = template.commands.map((command): RenderedCommandPlan => ({
      phase: command.phase,
      name: command.name,
      shell: command.shell,
      command: renderTemplateText(command.commandTemplate, template.variables, variables),
      workingDirectory: renderText(command.workingDirectory),
      timeoutSeconds: command.timeoutSeconds,
      expectedExitCodes: [...command.expectedExitCodes],
      requiredCapabilities: [...command.requiredCapabilities],
      riskLevel: command.riskLevel,
    }));
    const files = (template.files ?? []).map((file): RenderedFilePlan => ({
      name: file.name,
      destinationPath: renderTemplateText(file.destinationPathTemplate, template.variables, variables),
      content: renderTemplateText(file.contentTemplate, template.variables, variables),
      requiredCapabilities: [...file.requiredCapabilities],
      riskLevel: file.riskLevel,
    }));
    const httpPlans = (template.httpPlans ?? []).map((plan): RenderedHttpPlan => ({
      name: plan.name,
      method: plan.method,
      url: renderTemplateText(plan.urlTemplate, template.variables, variables),
      body: renderText(plan.bodyTemplate),
      headers: Object.fromEntries(Object.entries(plan.headers ?? {}).map(([key, value]) => [key, renderTemplateText(value, template.variables, variables)])),
      requiredCapabilities: [...plan.requiredCapabilities],
      riskLevel: plan.riskLevel,
    }));
    const rollback = (template.rollback ?? []).map((command): RenderedCommandPlan => ({
      phase: command.phase,
      name: command.name,
      shell: command.shell,
      command: renderTemplateText(command.commandTemplate, template.variables, variables),
      workingDirectory: renderText(command.workingDirectory),
      timeoutSeconds: command.timeoutSeconds,
      expectedExitCodes: [...command.expectedExitCodes],
      requiredCapabilities: [...command.requiredCapabilities],
      riskLevel: command.riskLevel,
    }));

    const binding: ManualBinding = {
      ...bindingSeed,
      templateId: template.id,
      templateVersion: template.version,
      certificatePath: renderText(template.paths.certificatePath),
      privateKeyPath: renderText(template.paths.privateKeyPath),
      keystorePath: renderText(template.paths.keystorePath),
      keystorePasswordRef: secretRefToString(variables.keystorePasswordRef),
      deploymentPolicy: bindingSeed.deploymentPolicy ?? {
        mode: template.riskPolicy.deploymentMode,
        allowAutoDeploy: template.riskPolicy.allowAutoDeploy,
        requiresManualApproval: template.riskPolicy.deploymentMode !== 'L5',
      },
      verificationPolicy: clone(template.verification),
      riskLevel: 'low',
      status: bindingSeed.status ?? 'pending_acceptance',
      updatedAt: new Date().toISOString(),
      renderedPlan: {
        commands,
        files,
        httpPlans,
        backupPath: renderText(template.paths.backupPath),
        rollback,
      },
    };

    return {
      binding,
      variableSnapshot: Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, sanitizeVariableValue(value)])),
    };
  }
}

export class CustomProviderAdapter implements Provider {
  getDescriptor(): ProviderDescriptor {
    return {
      metadata: {
        id: 'custom-provider',
        type: 'CUSTOM',
        displayName: '自定义 Provider',
        description: '把手工绑定和模板化自定义服务映射为标准发现结果和部署草案，不执行真实命令。',
        version: '0.1.0',
        capabilities: ['DISCOVERY', 'STEP_DRAFT_MAPPING', 'SNAPSHOT_PERSISTENCE'],
        supportedDiscoverySources: ['MANUAL', 'AGENT', 'GATEWAY', 'SSH'],
        supportedStages: ['HOST', 'SERVICE', 'ENDPOINT', 'BINDING'],
        tags: ['custom', 'manual-binding'],
        priority: 5,
      },
      matchRules: {
        providerType: 'CUSTOM',
        serviceNames: ['custom'],
        endpointProtocols: ['HTTPS', 'TLS', 'HTTP'],
        tags: ['custom'],
      },
    };
  }

  discover(_context: DiscoveryExecutionContext, input: { source: DiscoveryResult['source']; scope: Record<string, string>; payload: Record<string, unknown> }): DiscoveryResult {
    const binding = normalizeManualBinding(resolveBindingFromPayload(input.payload));
    const hostname = (input.scope.hostname ?? binding.hostname).toLowerCase();
    const hostKey = `host:${binding.hostId}`;
    const serviceKey = `service:${binding.id}`;
    const endpointKey = `endpoint:${binding.id}:${binding.listenPort ?? 443}`;
    const bindingKey = `binding:${binding.id}`;
    return {
      providerId: 'custom-provider',
      providerType: 'CUSTOM',
      source: input.source,
      discoveredAt: new Date().toISOString(),
      scope: input.scope,
      hosts: [{
        key: hostKey,
        hostname,
        ipAddresses: [],
        osType: input.scope.osType ?? 'UNKNOWN',
        tags: ['custom'],
        rawFacts: { manualBindingId: binding.id },
      }],
      services: [{
        key: serviceKey,
        hostKey,
        providerType: 'CUSTOM',
        serviceName: binding.serviceName,
        displayName: binding.serviceName,
        configPath: binding.certificatePath ?? binding.keystorePath,
        status: binding.status === 'disabled' ? 'RETIRED' : 'ACTIVE',
        rawFacts: {
          serviceType: binding.serviceType,
          templateId: binding.templateId,
          templateVersion: binding.templateVersion,
          deploymentMode: binding.deploymentPolicy.mode,
          acceptanceStatus: binding.acceptance?.status,
        },
      }],
      endpoints: [{
        key: endpointKey,
        serviceKey,
        protocol: binding.listenPort === 80 ? 'HTTP' : 'HTTPS',
        hostName: binding.listenHost ?? binding.domains[0] ?? hostname,
        port: binding.listenPort ?? 443,
        pathHint: binding.certificatePath ?? binding.keystorePath,
        status: 'ACTIVE',
        rawFacts: { domains: binding.domains },
      }],
      bindings: [{
        key: bindingKey,
        endpointKey,
        bindingType: binding.keystorePath ? 'KEYSTORE' : 'FILE_PATH',
        domainName: binding.domains[0],
        certificateRef: binding.certificatePath ? `file://${binding.certificatePath}` : undefined,
        privateKeyRef: binding.privateKeyPath ? `file://${binding.privateKeyPath}` : undefined,
        configPath: binding.certificatePath ?? binding.keystorePath,
        rawFacts: {
          manualBindingId: binding.id,
          certificateFormat: binding.certificateFormat,
          observedFingerprint: binding.acceptance?.observedFingerprint,
          evidenceRef: binding.acceptance?.evidenceRef,
          auditRef: binding.acceptance?.auditRef,
          plan: binding.renderedPlan,
          verificationPolicy: binding.verificationPolicy,
          deploymentPolicy: binding.deploymentPolicy,
        },
      }],
      rawPayload: {
        manualBindingId: binding.id,
        status: binding.status,
        acceptanceStatus: binding.acceptance?.status,
      },
    };
  }

  toDeploymentDraft(result: DiscoveryResult): DeploymentDraftBundle {
    const steps: DeploymentStepDraft[] = [];
    for (const bindingResult of result.bindings) {
      const plan = bindingResult.rawFacts?.plan as ManualBinding['renderedPlan'] | undefined;
      const verification = (bindingResult.rawFacts?.verificationPolicy as CustomVerificationStrategy[] | undefined) ?? [];
      const deploymentPolicy = bindingResult.rawFacts?.deploymentPolicy as ManualBinding['deploymentPolicy'] | undefined;
      const endpoint = result.endpoints.find((item) => item.key === bindingResult.endpointKey);
      const service = endpoint ? result.services.find((item) => item.key === endpoint.serviceKey) : undefined;
      let dependsOn: string[] = [];
      const pushStep = (name: string, title: string, action: DeploymentStepDraft['action'], capabilities: string[], inputs: Record<string, unknown>, riskLevel: RiskLevel): string => {
        const id = stableId(result.providerId, bindingResult.key, name);
        steps.push({
          id,
          title,
          action,
          providerType: result.providerType,
          serviceKey: service?.key,
          endpointKey: endpoint?.key,
          bindingKey: bindingResult.key,
          target: { hostKey: service?.hostKey, serviceKey: service?.key, endpointKey: endpoint?.key, bindingKey: bindingResult.key },
          inputs,
          dependsOn,
          requiredCapabilities: capabilities,
          riskLevel,
          idempotencyKey: id,
          rollbackHint: '使用备份产物恢复原证书材料；如果是 manual-only，必须由人工按审计记录恢复。',
        });
        dependsOn = [id];
        return id;
      };

      pushStep('backup', '备份自定义服务证书材料', 'BACKUP', ['file.read', 'backup.write'], {
        certificateRef: bindingResult.certificateRef,
        privateKeyRef: bindingResult.privateKeyRef,
        backupPath: plan?.backupPath,
      }, 'medium');

      for (const file of plan?.files ?? []) {
        pushStep(`file:${file.name}`, `渲染文件 ${file.name}`, 'RENDER_FILE', file.requiredCapabilities, {
          destinationPath: file.destinationPath,
          contentPreview: redactRenderedText(file.content),
        }, file.riskLevel);
      }
      for (const command of plan?.commands ?? []) {
        pushStep(`command:${command.phase}:${command.name}`, `规划命令 ${command.name}`, command.phase === 'restart' ? 'RELOAD_SERVICE' : 'RENDER_COMMAND', command.requiredCapabilities, {
          phase: command.phase,
          shell: command.shell,
          command: redactRenderedText(command.command),
          workingDirectory: command.workingDirectory,
          timeoutSeconds: command.timeoutSeconds,
          expectedExitCodes: command.expectedExitCodes,
        }, command.riskLevel);
      }
      for (const httpPlan of plan?.httpPlans ?? []) {
        pushStep(`http:${httpPlan.name}`, `规划 HTTP 调用 ${httpPlan.name}`, 'HTTP_REQUEST', httpPlan.requiredCapabilities, {
          method: httpPlan.method,
          url: httpPlan.url,
          headers: redactRecord(httpPlan.headers),
          bodyPreview: httpPlan.body ? redactRenderedText(httpPlan.body) : undefined,
        }, httpPlan.riskLevel);
      }

      const needsManual = deploymentPolicy?.mode === 'manual-only' || deploymentPolicy?.requiresManualApproval || verification.some((item) => item.type === 'manual' || item.manual);
      if (needsManual) {
        pushStep('manual-approval', '人工审批自定义绑定', 'MANUAL_APPROVAL', ['manual.approval'], {
          evidenceRequired: true,
          mode: deploymentPolicy?.mode ?? 'manual-only',
        }, 'high');
      }

      for (const strategy of verification) {
        pushStep(`verify:${strategy.type}`, `验证自定义绑定 ${strategy.type}`, strategy.type === 'manual' ? 'MANUAL_CHECK' : 'VERIFY_BINDING', strategy.requiredCapabilities, {
          type: strategy.type,
          target: sanitizeObject(strategy.target),
          assertions: sanitizeObject(strategy.assertions),
          timeoutSeconds: strategy.timeoutSeconds,
        }, strategy.type === 'manual' ? 'high' : 'medium');
      }
    }

    return {
      providerId: result.providerId,
      providerType: result.providerType,
      steps,
      summary: {
        hostCount: result.hosts.length,
        serviceCount: result.services.length,
        endpointCount: result.endpoints.length,
        bindingCount: result.bindings.length,
        stepCount: steps.length,
      },
    };
  }
}

export class CustomProvider extends CustomProviderAdapter {}

export class CustomRiskAnalyzer {
  analyze(binding: ManualBinding): CustomRiskNotice[] {
    const notices: CustomRiskNotice[] = [];
    if (!binding.verificationPolicy.length) {
      notices.push({ code: 'missing_verification', level: 'critical', message: '缺少验证策略，不能自动部署。', fieldPath: 'verificationPolicy' });
    }
    if (binding.deploymentPolicy.mode === 'manual-only' || binding.deploymentPolicy.requiresManualApproval) {
      notices.push({ code: 'manual_capability', level: 'high', message: '存在人工能力或人工审批，执行链路必须保留证据。', fieldPath: 'deploymentPolicy' });
    }
    if (!binding.renderedPlan?.rollback?.length) {
      notices.push({ code: 'no_rollback', level: 'high', message: '缺少回滚定义，失败后只能人工恢复。', fieldPath: 'renderedPlan.rollback' });
    }
    scanPlaintextRisk(binding, notices);
    for (const command of binding.renderedPlan?.commands ?? []) {
      if (/\brm\s+-rf\b|\bchmod\s+777\b|\bcurl\b.+\|\s*(sh|bash)|\bservice\b.+\bstop\b/i.test(command.command)) {
        notices.push({ code: 'dangerous_command', level: 'critical', message: `命令 ${command.name} 包含高风险操作。`, fieldPath: `renderedPlan.commands.${command.name}` });
      }
    }
    return notices;
  }
}

export class CustomBindingAcceptanceService {
  accept(binding: ManualBinding, acceptance: ManualBindingAcceptance): ManualBinding {
    if (acceptance.status !== 'accepted') {
      return { ...binding, acceptance: { ...acceptance }, status: 'rejected', updatedAt: new Date().toISOString() };
    }
    if (!acceptance.evidenceRef || !acceptance.operator || !acceptance.auditRef) {
      throw new AppError('VALIDATION_FAILED', '人工绑定验收缺少 evidenceRef/operator/auditRef');
    }
    return {
      ...binding,
      acceptance: { ...acceptance, acceptedAt: acceptance.acceptedAt ?? new Date().toISOString() },
      status: 'accepted',
      updatedAt: new Date().toISOString(),
    };
  }
}

function validateTemplate(template: CustomProviderTemplate): void {
  if (template.status !== 'published') throw new AppError('VALIDATION_FAILED', '只能渲染已发布模板', { templateId: template.id, status: template.status });
  const names = new Set<string>();
  for (const variable of template.variables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.name)) throw new AppError('VALIDATION_FAILED', '变量名不合法', { variable: variable.name });
    if (names.has(variable.name)) throw new AppError('VALIDATION_FAILED', '变量名重复', { variable: variable.name });
    if (variable.type === 'secret' && variable.defaultValue !== undefined) throw new AppError('VALIDATION_FAILED', 'secret 变量不能有默认值', { variable: variable.name });
    names.add(variable.name);
  }
  const allTemplates = [
    ...Object.values(template.paths),
    ...template.commands.flatMap((command) => [command.commandTemplate, command.workingDirectory]),
    ...(template.files ?? []).flatMap((file) => [file.destinationPathTemplate, file.contentTemplate]),
    ...(template.httpPlans ?? []).flatMap((plan) => [plan.urlTemplate, plan.bodyTemplate, ...Object.values(plan.headers ?? {})]),
    ...(template.rollback ?? []).flatMap((command) => [command.commandTemplate, command.workingDirectory]),
  ].filter((item): item is string => typeof item === 'string');
  for (const text of allTemplates) {
    for (const variableName of extractVariableNames(text)) {
      if (!names.has(variableName)) throw new AppError('VALIDATION_FAILED', '模板引用未声明变量', { variable: variableName });
    }
  }
}

function resolveVariables(definitions: TemplateVariable[], values: RenderValues): RenderValues {
  const allowed = new Set(definitions.map((definition) => definition.name));
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) throw new AppError('VALIDATION_FAILED', '变量未声明，拒绝渲染', { variable: key });
  }
  const output: RenderValues = {};
  for (const definition of definitions) {
    const value = values[definition.name] ?? definition.defaultValue;
    if (value === undefined || value === null || value === '') {
      if (definition.required) throw new AppError('VALIDATION_FAILED', '必填变量缺失', { variable: definition.name });
      continue;
    }
    output[definition.name] = validateVariableValue(definition, value);
  }
  return output;
}

function validateVariableValue(definition: TemplateVariable, value: unknown): unknown {
  if (definition.type === 'secret') {
    if (!isSecretRef(value)) throw new AppError('VALIDATION_FAILED', 'secret 变量必须使用 SecretRef', { variable: definition.name });
    return value;
  }
  if (definition.sensitive && typeof value === 'string' && !isSecretRefString(value)) {
    throw new AppError('VALIDATION_FAILED', '敏感变量必须使用 SecretRef', { variable: definition.name });
  }
  if (definition.type === 'number' && typeof value !== 'number') throw new AppError('VALIDATION_FAILED', '变量类型必须是 number', { variable: definition.name });
  if (definition.type === 'boolean' && typeof value !== 'boolean') throw new AppError('VALIDATION_FAILED', '变量类型必须是 boolean', { variable: definition.name });
  if (!['number', 'boolean'].includes(definition.type) && typeof value !== 'string' && !isSecretRef(value)) {
    throw new AppError('VALIDATION_FAILED', '变量类型必须是 string 或 SecretRef', { variable: definition.name });
  }
  const text = stringifyVariable(value);
  if (definition.allowedPattern && !new RegExp(definition.allowedPattern).test(text)) {
    throw new AppError('VALIDATION_FAILED', '变量不符合白名单正则', { variable: definition.name });
  }
  if (typeof value === 'string' && /-----BEGIN [A-Z ]*PRIVATE KEY-----|password=|token=|sk-[A-Za-z0-9]{20,}/i.test(value)) {
    throw new AppError('VALIDATION_FAILED', '变量包含疑似明文敏感信息', { variable: definition.name });
  }
  return value;
}

function renderTemplateText(templateText: string, definitions: TemplateVariable[], values: RenderValues): string {
  const definitionMap = new Map(definitions.map((definition) => [definition.name, definition]));
  return templateText.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_match, variableName: string) => {
    const definition = definitionMap.get(variableName);
    if (!definition) throw new AppError('VALIDATION_FAILED', '模板引用未声明变量', { variable: variableName });
    const value = values[variableName];
    if (value === undefined) throw new AppError('VALIDATION_FAILED', '模板变量没有值', { variable: variableName });
    if (definition.type === 'secret' || definition.sensitive) return secretRefToString(value);
    return stringifyVariable(value);
  });
}

function extractVariableNames(templateText: string): string[] {
  return [...templateText.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map((match) => match[1]!);
}

function resolveBindingFromPayload(payload: Record<string, unknown>): ManualBinding {
  if (isRecord(payload.binding)) return payload.binding as unknown as ManualBinding;
  if (isRecord(payload.template) && isRecord(payload.values) && isRecord(payload.bindingSeed)) {
    return new TemplateRenderService().render(payload.template as unknown as CustomProviderTemplate, payload.values as RenderValues, payload.bindingSeed as Parameters<TemplateRenderService['render']>[2]).binding;
  }
  throw new AppError('VALIDATION_FAILED', 'custom provider payload 必须包含 binding 或 template/values/bindingSeed');
}

function normalizeManualBinding(binding: ManualBinding): ManualBinding {
  if (!binding.id || !binding.hostId || !binding.hostname || !binding.serviceName) throw new AppError('VALIDATION_FAILED', 'ManualBinding 缺少基础字段');
  if (binding.listenPort !== undefined && (!Number.isInteger(binding.listenPort) || binding.listenPort < 1 || binding.listenPort > 65535)) {
    throw new AppError('VALIDATION_FAILED', 'listenPort 必须在 1 到 65535 之间');
  }
  if (binding.keystorePasswordRef && !isSecretRefString(binding.keystorePasswordRef)) throw new AppError('VALIDATION_FAILED', 'keystorePasswordRef 必须是 SecretRef');
  return {
    ...binding,
    domains: [...new Set(binding.domains.map((domain) => domain.toLowerCase()))],
  };
}

function scanPlaintextRisk(value: unknown, notices: CustomRiskNotice[], path: string[] = []): void {
  if (typeof value === 'string') {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|password=|token=|sk-[A-Za-z0-9]{20,}/i.test(value)) {
      notices.push({ code: 'plaintext_secret', level: 'critical', message: '发现疑似明文敏感信息。', fieldPath: path.join('.') });
    }
    return;
  }
  if (Array.isArray(value)) value.forEach((item, index) => scanPlaintextRisk(item, notices, [...path, String(index)]));
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (['password', 'privatekey', 'secret', 'token'].includes(normalized) && child && !String(key).toLowerCase().endsWith('ref')) {
        notices.push({ code: 'plaintext_secret', level: 'critical', message: '敏感字段不能保存明文。', fieldPath: [...path, key].join('.') });
      }
      scanPlaintextRisk(child, notices, [...path, key]);
    }
  }
}

function sanitizeVariableValue(value: unknown): unknown {
  if (isSecretRef(value)) return { secretRef: value.secretRef };
  return clone(value);
}

function sanitizeObject<T>(value: T): T {
  return clone(value);
}

function redactRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, /authorization|token|secret/i.test(key) ? '[REDACTED]' : redactRenderedText(value)]));
}

function redactRenderedText(value: string): string {
  return value
    .split('\n')
    .filter((line) => !/[A-Za-z0-9_-]*(password|token)[A-Za-z0-9_-]*\s*=/i.test(line))
    .join('\n')
    .replace(/secret:\/\/[A-Za-z0-9/_:.-]+(?:#[A-Za-z0-9/_:.-]+)?/g, '[REDACTED]')
    .trim();
}

function secretRefToString(value: unknown): string {
  if (isSecretRef(value)) return value.secretRef;
  if (typeof value === 'string' && isSecretRefString(value)) return value;
  throw new AppError('VALIDATION_FAILED', 'SecretRef 格式不合法');
}

function stringifyVariable(value: unknown): string {
  if (isSecretRef(value)) return value.secretRef;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new AppError('VALIDATION_FAILED', '变量无法渲染为文本');
}

function isSecretRef(value: unknown): value is SecretRef {
  return isRecord(value) && typeof value.secretRef === 'string' && isSecretRefString(value.secretRef);
}

function isSecretRefString(value: string): boolean {
  return /^secret:\/\/[A-Za-z0-9/_:.-]+(?:#[A-Za-z0-9/_:.-]+)?$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableId(...parts: string[]): string {
  return `custom_${createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)}`;
}
