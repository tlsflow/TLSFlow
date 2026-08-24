import { AppError } from '../../common/errors/app-error.js';
import { newId } from '../../shared/id.js';
import type {
  AdapterContext,
  AdapterExecutionResult,
  GatewayAdapterType,
  GatewayEvidence,
  GatewayTask,
  GrantRef,
  PrecheckResult,
  SecretRef,
} from './gateway-agent.types.js';

export interface ProductionAdapterContext extends AdapterContext {
  grantRef: GrantRef;
  secretRef?: SecretRef;
}

export interface ProductionGatewayAdapterDescriptor {
  type: GatewayAdapterType;
  displayName: string;
  capabilities: string[];
  supportedActions: string[];
  mockSafe: false;
  requiresSecretRef: boolean;
  requiresGrantRef: true;
  precheck(ctx: ProductionAdapterContext): Promise<PrecheckResult> | PrecheckResult;
  run(ctx: ProductionAdapterContext, task: GatewayTask): Promise<AdapterExecutionResult> | AdapterExecutionResult;
}

export interface ProductionGatewayAdapterRuntimeOptions {
  descriptors?: ProductionGatewayAdapterDescriptor[];
  fetchImpl?: typeof fetch;
}

export class ProductionGatewayAdapterRuntime {
  private readonly adapters = new Map<string, ProductionGatewayAdapterDescriptor>();

  constructor(options: ProductionGatewayAdapterRuntimeOptions = {}) {
    for (const descriptor of options.descriptors ?? createDefaultProductionDescriptors(options.fetchImpl)) {
      this.register(descriptor);
    }
  }

  register(descriptor: ProductionGatewayAdapterDescriptor): void {
    if (descriptor.mockSafe !== false) {
      throw new AppError('VALIDATION_FAILED', '生产 Gateway Adapter 禁止注册 mockSafe descriptor', { adapter: descriptor.type });
    }
    this.adapters.set(descriptor.type, descriptor);
  }

  get(type: string): ProductionGatewayAdapterDescriptor | undefined {
    return this.adapters.get(type);
  }

  list(): ProductionGatewayAdapterDescriptor[] {
    return [...this.adapters.values()];
  }

  capabilities(): string[] {
    return this.list().flatMap((adapter) => adapter.capabilities);
  }

  async run(ctx: AdapterContext, task: GatewayTask): Promise<AdapterExecutionResult> {
    const adapter = this.adapters.get(task.adapter);
    if (!adapter) throw new AppError('RESOURCE_NOT_FOUND', '生产 Gateway Adapter 不可用，拒绝静默 mock 成功', { adapter: task.adapter });
    const productionContext = this.requireProductionContext(ctx, adapter);
    const precheck = await adapter.precheck(productionContext);
    if (!precheck.ok) throw new AppError('VALIDATION_FAILED', precheck.reason ?? '生产 Gateway Adapter 预检失败', { adapter: task.adapter });
    return adapter.run(productionContext, task);
  }

  private requireProductionContext(ctx: AdapterContext, adapter: ProductionGatewayAdapterDescriptor): ProductionAdapterContext {
    if (!ctx.gatewayId) throw new AppError('VALIDATION_FAILED', '生产 Gateway Adapter 缺少 gatewayId', { adapter: adapter.type });
    if (!ctx.grantRef?.ref) throw new AppError('VALIDATION_FAILED', '生产 Gateway Adapter 必须持有 GrantRef，拒绝无授权执行', { adapter: adapter.type });
    return { ...ctx, grantRef: ctx.grantRef };
  }
}

export function createDefaultProductionDescriptors(fetchImpl: typeof fetch = fetch): ProductionGatewayAdapterDescriptor[] {
  return [
    createCurlProductionAdapter(fetchImpl),
    blockedProtocolAdapter('ssh', 'SSH Production Adapter', ['read', 'write', 'exec', 'upload'], ['adapter.ssh', 'gateway.ssh.real']),
    blockedProtocolAdapter('winrm', 'WinRM Production Adapter', ['read', 'write', 'exec', 'upload'], ['adapter.winrm', 'gateway.winrm.real']),
    blockedProtocolAdapter('smb', 'SMB Production Adapter', ['read', 'write', 'upload'], ['adapter.smb', 'gateway.smb.real']),
    blockedProtocolAdapter('wmi', 'WMI Production Adapter', ['read', 'exec'], ['adapter.wmi', 'gateway.wmi.real']),
  ];
}

export interface GatewayCurlPayload {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  headerRefs?: Record<string, string>;
  body?: unknown;
  bodySecretRef?: string;
  tls?: {
    caSecretRef?: string;
    clientCertSecretRef?: string;
    verify?: boolean;
  };
  timeoutMs?: number;
  approvalPolicyRef?: string;
  allowPlainHttpWithApproval?: boolean;
  expectedStatusCodes?: number[];
}

function createCurlProductionAdapter(fetchImpl: typeof fetch): ProductionGatewayAdapterDescriptor {
  return {
    type: 'curl',
    displayName: 'CURL Production Adapter',
    capabilities: ['adapter.curl', 'gateway.curl.real', 'http.https_only', 'http.secret_ref'],
    supportedActions: ['read', 'write'],
    mockSafe: false,
    requiresSecretRef: false,
    requiresGrantRef: true,
    precheck(ctx) {
      if (!ctx.grantRef.ref) return { ok: false, reason: 'CURL 生产执行缺少 GrantRef' };
      return { ok: true };
    },
    async run(ctx, task) {
      const payload = parseCurlPayload(task.payload);
      const url = new URL(payload.url);
      validateCurlUrl(url, payload);
      validateNoPlainSecrets(payload);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), payload.timeoutMs ?? 30_000);
      try {
        const response = await fetchImpl(url, {
          method: payload.method ?? (payload.body === undefined && !payload.bodySecretRef ? 'GET' : 'POST'),
          headers: renderHeaders(payload),
          body: renderBody(payload),
          signal: controller.signal,
        });
        const bodyText = await response.text();
        const expected = payload.expectedStatusCodes ?? [200, 201, 202, 204];
        const success = expected.includes(response.status);
        const summary = `HTTP ${response.status} ${response.statusText}`;
        return {
          success,
          status: success ? 'success' : 'failed',
          summary,
          evidence: [responseEvidence(task, ctx, summary, bodyText, response.status, [...response.headers.keys()])],
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function blockedProtocolAdapter(type: GatewayAdapterType, displayName: string, supportedActions: string[], capabilities: string[]): ProductionGatewayAdapterDescriptor {
  return {
    type,
    displayName,
    capabilities,
    supportedActions,
    mockSafe: false,
    requiresSecretRef: true,
    requiresGrantRef: true,
    precheck(ctx) {
      if (!ctx.grantRef.ref) return { ok: false, reason: `${displayName} 缺少 GrantRef` };
      return { ok: true };
    },
    run() {
      throw new AppError('VALIDATION_FAILED', `${displayName} 真实协议依赖尚未接入，生产路径禁止默认 mock 成功`, { adapter: type });
    },
  };
}

function parseCurlPayload(payload: Record<string, unknown>): GatewayCurlPayload {
  const candidate = (payload.curlRequest && typeof payload.curlRequest === 'object' ? payload.curlRequest : payload) as Record<string, unknown>;
  const url = typeof candidate.url === 'string' ? candidate.url : undefined;
  if (!url) throw new AppError('VALIDATION_FAILED', 'CURL GatewayTask payload 缺少 url', { field: 'payload.url' });
  return {
    url,
    method: typeof candidate.method === 'string' ? candidate.method as GatewayCurlPayload['method'] : undefined,
    headers: isStringRecord(candidate.headers) ? candidate.headers : undefined,
    headerRefs: isStringRecord(candidate.headerRefs) ? candidate.headerRefs : undefined,
    body: candidate.body,
    bodySecretRef: typeof candidate.bodySecretRef === 'string' ? candidate.bodySecretRef : undefined,
    tls: candidate.tls && typeof candidate.tls === 'object' && !Array.isArray(candidate.tls) ? normalizeTls(candidate.tls as Record<string, unknown>) : undefined,
    timeoutMs: typeof candidate.timeoutMs === 'number' ? candidate.timeoutMs : undefined,
    approvalPolicyRef: typeof candidate.approvalPolicyRef === 'string' ? candidate.approvalPolicyRef : undefined,
    allowPlainHttpWithApproval: candidate.allowPlainHttpWithApproval === true,
    expectedStatusCodes: Array.isArray(candidate.expectedStatusCodes) ? candidate.expectedStatusCodes.filter((item): item is number => Number.isInteger(item)) : undefined,
  };
}

function validateCurlUrl(url: URL, payload: GatewayCurlPayload): void {
  if (!['https:', 'http:'].includes(url.protocol)) throw new AppError('VALIDATION_FAILED', 'CURL 生产执行只允许 HTTP/HTTPS URL', { url: url.toString() });
  if (url.protocol === 'https:') return;
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (!local && !(payload.allowPlainHttpWithApproval && isApprovalPolicyRef(payload.approvalPolicyRef))) {
    throw new AppError('VALIDATION_FAILED', 'CURL 生产执行默认只允许 HTTPS；非本地 HTTP 必须走审批策略', { url: url.toString() });
  }
}

function validateNoPlainSecrets(payload: GatewayCurlPayload): void {
  scanSecretLike(payload.headers ?? {}, ['headers']);
  scanSecretLike(payload.body, ['body']);
  if (payload.headers?.Authorization && !payload.headerRefs?.Authorization) {
    throw new AppError('VALIDATION_FAILED', 'Authorization 必须通过 headerRefs/SecretRef 提供，禁止明文进入 Gateway payload');
  }
  if (payload.bodySecretRef && !/^secret:\/\/.+/.test(payload.bodySecretRef)) {
    throw new AppError('VALIDATION_FAILED', 'bodySecretRef 必须使用 SecretRef');
  }
  for (const [name, ref] of Object.entries(payload.headerRefs ?? {})) {
    if (!/^secret:\/\/.+/.test(ref)) throw new AppError('VALIDATION_FAILED', 'headerRefs 必须使用 SecretRef', { header: name });
  }
  if (payload.tls?.verify === false && !isApprovalPolicyRef(payload.approvalPolicyRef)) {
    throw new AppError('VALIDATION_FAILED', '跳过 TLS 校验必须走审批策略', { field: 'tls.verify' });
  }
  if (payload.tls?.caSecretRef && !/^secret:\/\/.+/.test(payload.tls.caSecretRef)) throw new AppError('VALIDATION_FAILED', 'CA 必须使用 SecretRef');
  if (payload.tls?.clientCertSecretRef && !/^secret:\/\/.+/.test(payload.tls.clientCertSecretRef)) throw new AppError('VALIDATION_FAILED', '客户端证书必须使用 SecretRef');
}

function renderHeaders(payload: GatewayCurlPayload): Record<string, string> | undefined {
  const headers: Record<string, string> = { ...(payload.headers ?? {}) };
  for (const name of Object.keys(payload.headerRefs ?? {})) headers[name] = `[SECRET_REF:${name}]`;
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function renderBody(payload: GatewayCurlPayload): BodyInit | undefined {
  if (payload.bodySecretRef) return '[SECRET_REF:body]';
  if (payload.body === undefined) return undefined;
  return typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body);
}

function normalizeTls(value: Record<string, unknown>): GatewayCurlPayload['tls'] {
  return {
    caSecretRef: typeof value.caSecretRef === 'string' ? value.caSecretRef : undefined,
    clientCertSecretRef: typeof value.clientCertSecretRef === 'string' ? value.clientCertSecretRef : undefined,
    verify: typeof value.verify === 'boolean' ? value.verify : undefined,
  };
}

function isApprovalPolicyRef(value: string | undefined): boolean {
  return typeof value === 'string' && /^approval:\/\/.+/.test(value);
}

function responseEvidence(task: GatewayTask, ctx: ProductionAdapterContext, summary: string, bodyText: string, statusCode: number, headerNames: string[]): Omit<GatewayEvidence, 'id' | 'createdAt'> {
  return {
    taskId: task.id,
    operatorId: task.operatorId,
    planId: task.planId,
    executionRunId: task.executionRunId,
    stepId: task.stepId,
    gatewayId: ctx.gatewayId,
    delegatedTargetId: task.delegatedTargetId,
    adapter: task.adapter,
    credentialSessionId: task.credentialSessionId,
    credentialLeaseId: task.credentialLeaseId,
    action: task.action,
    result: statusCode >= 200 && statusCode < 300 ? 'success' : 'failed',
    evidenceRef: `gateway-response://${task.id}/${newId('response')}`,
    kind: 'response_summary',
    summary,
    metadata: {
      mockSafe: false,
      statusCode,
      headerNames: headerNames.sort(),
      bodyPreview: bodyText.slice(0, 512),
      responseSummary: summary,
      tls: task.payload?.tls && typeof task.payload.tls === 'object'
        ? {
          hasCaSecretRef: Boolean((task.payload.tls as Record<string, unknown>).caSecretRef),
          hasClientCertSecretRef: Boolean((task.payload.tls as Record<string, unknown>).clientCertSecretRef),
          verify: (task.payload.tls as Record<string, unknown>).verify,
        }
        : undefined,
    },
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.values(value as Record<string, unknown>).every((item) => typeof item === 'string');
}

function scanSecretLike(value: unknown, path: string[]): void {
  if (typeof value === 'string' && /(password|token|api[_-]?key|authorization)\s*[:=]|bearer\s+[a-z0-9._-]{10,}|sk-[a-z0-9]{20,}/i.test(value)) {
    throw new AppError('VALIDATION_FAILED', 'Gateway CURL payload 包含疑似明文敏感信息', { fieldPath: path.join('.') });
  }
  if (Array.isArray(value)) value.forEach((item, index) => scanSecretLike(item, [...path, String(index)]));
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      scanSecretLike(child, [...path, key]);
    }
  }
}
