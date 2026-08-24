import type { DatabasePort } from '../../database/database-port.js';
import { DeploymentPlansRepository } from '../../modules/deployment-plans/repository/deployment-plans.repository.js';
import { ExecutionsRepository } from '../../modules/executions/repository/executions.repository.js';

export type DeploymentPersistenceBackend = 'postgres';

export interface DeploymentPersistenceOptions {
  backend?: DeploymentPersistenceBackend;
  env?: NodeJS.ProcessEnv;
  db?: DatabasePort;
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
  return {
    backend,
    durable: true,
    deploymentPlans: new DeploymentPlansRepository(options.db),
    executions: new ExecutionsRepository(options.db),
  };
}

function readBackend(env: NodeJS.ProcessEnv): DeploymentPersistenceBackend {
  return 'postgres';
}
