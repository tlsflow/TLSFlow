export interface AppConfig {
  env: string;
  host: string;
  port: number;
  apiPrefix: string;
  openApiEnabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  agentInstallPublicBaseUrl?: string;
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    env: env.NODE_ENV ?? 'development',
    host: env.HOST ?? '0.0.0.0',
    port: parsePort(env.PORT, 3003),
    apiPrefix: env.API_PREFIX ?? '/api/v1',
    openApiEnabled: env.OPENAPI_ENABLED !== 'false',
    logLevel: (env.LOG_LEVEL as AppConfig['logLevel']) ?? 'info',
    agentInstallPublicBaseUrl: env.GCAC_AGENT_INSTALL_PUBLIC_BASE_URL?.trim() || undefined,
  };
}
