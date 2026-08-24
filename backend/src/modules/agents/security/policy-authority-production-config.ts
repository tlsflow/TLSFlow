import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { AppError } from '../../../common/errors/app-error.js';
import {
  createProductionPolicyAuthorityServicesV1,
  type ProductionPolicyAuthorityServicesV1,
} from './policy-authority.service.js';
import { resolveProductionPolicyAuthorityProcessConfig } from './policy-authority-process.js';

export type PolicyAuthorityProductionProcessRoleV1 = 'host' | 'standalone';

export interface PolicyAuthorityProductionConfigSummaryV1 {
  status: 'valid';
  processRole: PolicyAuthorityProductionProcessRoleV1;
  authorityId: string;
  rootKeyId: string;
  bootstrapId: string;
  activeKeyId: string;
  keySetIssuedAt: string;
  stateFile: string;
  executablePath?: string;
}

/**
 * 验证完整生产部署材料但不启动任何进程。输出只包含身份和版本摘要，绝不回显私钥、策略包或签名材料。
 * host 模式验证宿主到独立 Policy Authority 子进程的完整配置；standalone 模式验证子进程自身配置。
 */
export function validateProductionPolicyAuthorityConfigV1(
  environment: NodeJS.ProcessEnv = process.env,
): PolicyAuthorityProductionConfigSummaryV1 {
  if (environment.NODE_ENV !== 'production') {
    failClosed('Policy Authority 生产配置验证必须运行在 production');
  }
  const processRole = environment.GCAC_POLICY_AUTHORITY_PROCESS_ROLE;
  if (processRole !== 'host' && processRole !== 'standalone') {
    failClosed('GCAC_POLICY_AUTHORITY_PROCESS_ROLE 必须是 host 或 standalone');
  }

  let processEnvironment = environment;
  let executablePath: string | undefined;
  if (processRole === 'host') {
    const processConfig = resolveProductionPolicyAuthorityProcessConfig(environment);
    processEnvironment = processConfig.environment;
    executablePath = processConfig.executablePath;
  }

  const services = createProductionPolicyAuthorityServicesV1(processEnvironment);
  return summarize(processRole, services, executablePath);
}

function summarize(
  processRole: PolicyAuthorityProductionProcessRoleV1,
  services: ProductionPolicyAuthorityServicesV1,
  executablePath: string | undefined,
): PolicyAuthorityProductionConfigSummaryV1 {
  const trustRoot = services.trustRoot.getTrustRoot();
  const bootstrap = services.service.getBootstrap();
  const keySet = services.service.getTrustedKeySet();
  if (!bootstrap) failClosed('生产 Policy Authority 缺少已校验 Bootstrap');
  return {
    status: 'valid',
    processRole,
    authorityId: trustRoot.authorityId,
    rootKeyId: trustRoot.rootKeyId,
    bootstrapId: bootstrap.bootstrapId,
    activeKeyId: keySet.activeKeyId,
    keySetIssuedAt: keySet.issuedAt,
    stateFile: services.state.getStatePath(),
    ...(executablePath === undefined ? {} : { executablePath }),
  };
}

function failClosed(message: string): never {
  throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', `Policy Authority 已失败关闭：${message}`, { fallback: false });
}

const invokedFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
const currentFilePath = fileURLToPath(import.meta.url);
if (invokedFilePath.toLowerCase() === currentFilePath.toLowerCase()) {
  try {
    process.stdout.write(`${JSON.stringify(validateProductionPolicyAuthorityConfigV1())}\n`);
  } catch (error) {
    process.stderr.write(`Policy Authority 生产配置验证失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
