import type {
  AgentCapabilityTokenV1,
  AgentExecutionReceiptV1,
  AgentPlanV1,
  AgentV2ContractType,
  PolicyAuthorityDecisionV1,
} from '../../agents/security/agent-security.contract.js';

/** Agent Core 长期允许的四类协议动作。产品语义必须由插件生成，不进入 Agent Core。 */
export type AgentPluginActionType = AgentV2ContractType;

/**
 * 宿主发往 Agent 的 v2 请求载荷。
 * 授权材料是请求的一部分，任何缺失都必须在宿主侧失败关闭。
 */
export interface AgentPluginV2RequestV1 {
  actionType: AgentPluginActionType;
  actionSchemaVersion: '1.0';
  requestId: string;
  agentId: string;
  tenantId: string;
  pluginId: string;
  pluginVersionId: string;
  capability: string;
  actions: string[];
  allowedPaths: string[];
  allowedServices: string[];
  artifactDigests: string[];
  plan?: AgentPlanV1;
  token: AgentCapabilityTokenV1;
  policyDecision: PolicyAuthorityDecisionV1;
  receipt?: AgentExecutionReceiptV1;
}
