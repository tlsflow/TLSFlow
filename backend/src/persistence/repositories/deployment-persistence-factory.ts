import { join } from 'node:path';
import { DeploymentPlansRepository } from '../../modules/deployment-plans/repository/deployment-plans.repository.js';
import type { DeploymentPlanEntity, DeploymentPlanTargetEntity, StateTransitionEventEntity } from '../../modules/deployment-plans/schema/deployment-plans.schema.js';
import { ExecutionsRepository } from '../../modules/executions/repository/executions.repository.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from '../../modules/executions/schema/executions.schema.js';
import { FileJsonRepositoryFactory } from './file-json-repository.js';

export type DeploymentPersistenceBackend = 'memory' | 'file';

export interface DeploymentPersistenceOptions {
  backend?: DeploymentPersistenceBackend;
  baseDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface DeploymentPersistenceRepositories {
  backend: DeploymentPersistenceBackend;
  durable: boolean;
  deploymentPlans: DeploymentPlansRepository;
  executions: ExecutionsRepository;
}

export function createDeploymentPersistenceRepositories(options: DeploymentPersistenceOptions = {}): DeploymentPersistenceRepositories {
  const env = options.env ?? process.env;
  const backend = options.backend ?? readBackend(env);
  if (backend === 'memory') {
    return {
      backend,
      durable: false,
      deploymentPlans: new DeploymentPlansRepository(),
      executions: new ExecutionsRepository(),
    };
  }

  const baseDir = options.baseDir ?? env.GCAC_PERSISTENCE_DIR ?? join(process.cwd(), '.gcac-data');
  const factory = new FileJsonRepositoryFactory(join(baseDir, 'deployment-orchestration'));
  return {
    backend,
    durable: true,
    deploymentPlans: new DeploymentPlansRepository(
      factory.collection<DeploymentPlanEntity>('deployment-plans'),
      factory.collection<DeploymentPlanTargetEntity>('deployment-plan-targets'),
      factory.collection<StateTransitionEventEntity>('state-transition-events'),
    ),
    executions: new ExecutionsRepository(
      factory.collection<ExecutionRunEntity>('execution-runs'),
      factory.collection<ExecutionStepEntity>('execution-steps'),
    ),
  };
}

function readBackend(env: NodeJS.ProcessEnv): DeploymentPersistenceBackend {
  const configured = env.GCAC_PERSISTENCE_BACKEND;
  if (configured === 'memory' || configured === 'file') return configured;

  // node:test 会并发创建大量默认 app，继续用共享持久目录会把固定幂等键互相污染。
  // 显式设置 GCAC_PERSISTENCE_DIR 或 GCAC_PERSISTENCE_BACKEND=file 时，测试也会走非易失实现。
  if (env.NODE_TEST_CONTEXT && !env.GCAC_PERSISTENCE_DIR) return 'memory';
  return 'file';
}
