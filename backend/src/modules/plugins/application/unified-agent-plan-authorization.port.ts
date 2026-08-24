import type {
  AgentLocalPolicyV1,
} from '../../agents/security/agent-security.contract.js';
import {
  isProductionPolicyAuthorityServicesV1,
  requireProductionPolicyAuthorityServicesV1,
  type PolicyAuthorityAuthorizationRequestV1,
  type PolicyAuthorityAuthorizationResultV1,
  type ProductionPolicyAuthorityServicesV1,
} from '../../agents/security/policy-authority.service.js';
import type { PolicyAuthorityProcessClientV1 } from '../../agents/security/policy-authority-process.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { ExecutionGrantEntity } from '../../../persistence/entities/execution-grant.entity.js';

export interface UnifiedAgentPlanPolicyAuthorityPortV1 {
  /** 读取并验证生产授权边界；任何安全依赖缺失都必须抛错。 */
  assertReady(): void;
  issueAuthorization(request: PolicyAuthorityAuthorizationRequestV1): PolicyAuthorityAuthorizationResultV1 | Promise<PolicyAuthorityAuthorizationResultV1>;
}

export interface UnifiedAgentPlanGrantPortV1 {
  validate(input: {
    grantId: string;
    tenantId: string;
    planId?: string;
    runId: string;
    stepId: string;
    executorType: string;
    action?: string;
  }): Promise<ExecutionGrantEntity>;
}

export interface UnifiedAgentPlanLocalPolicyPortV1 {
  resolve(input: { agentId: string; tenantId: string }): Promise<unknown>;
}

export interface UnifiedAgentPlanAuthorizationDependenciesV1 {
  policyAuthority: UnifiedAgentPlanPolicyAuthorityPortV1;
  grants: UnifiedAgentPlanGrantPortV1;
  localPolicy: UnifiedAgentPlanLocalPolicyPortV1;
}

/**
 * 只允许生产工厂生成的完整 Policy Authority 资源进入编译器。
 * 这层适配器不生成任何密钥或审批记录，只把已有生产资源收窄成编译器需要的接口。
 */
export function createUnifiedAgentPlanPolicyAuthorityPortV1(
  services: ProductionPolicyAuthorityServicesV1,
): UnifiedAgentPlanPolicyAuthorityPortV1 {
  if (!isProductionPolicyAuthorityServicesV1(services)) {
    throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', '拒绝将非生产 Policy Authority 资源接入 Agent Plan 编译', { fallback: false });
  }
  const production = requireProductionPolicyAuthorityServicesV1(services);
  return {
    assertReady: () => assertProductionPolicyAuthorityReady(production),
    issueAuthorization: (request) => production.service.issueAuthorization(request),
  };
}

/**
 * 生产宿主只持有 Policy Authority IPC 客户端，不持有签发私钥或进程内签发服务。
 */
export function createUnifiedAgentPlanPolicyAuthorityProcessPortV1(
  client: PolicyAuthorityProcessClientV1,
): UnifiedAgentPlanPolicyAuthorityPortV1 {
  client.assertReady();
  return {
    assertReady: () => client.assertReady(),
    issueAuthorization: (request) => client.issueAuthorization(request),
  };
}

function assertProductionPolicyAuthorityReady(services: ProductionPolicyAuthorityServicesV1): void {
  try {
    const trustRoot = services.trustRoot.getTrustRoot();
    const bootstrap = services.bootstrap.load(trustRoot);
    const keySetEnvelope = services.keySet.load();
    const keySet = services.service.getTrustedKeySet();
    if (!trustRoot || !bootstrap || !keySetEnvelope || !keySet || !services.state
      || typeof services.state.isKeyRevoked !== 'function'
      || typeof services.state.isTokenRevoked !== 'function'
      || typeof services.state.consume !== 'function') {
      throw new Error('Policy Authority 生产依赖不完整');
    }
  } catch (error) {
    throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', 'Policy Authority 生产信任根、KeySet 或撤销状态不可用', {
      cause: error instanceof Error ? error.message : String(error),
      fallback: false,
    });
  }
}
