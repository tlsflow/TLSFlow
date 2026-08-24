export interface AppConfig {
  env: string;
  host: string;
  port: number;
  apiPrefix: string;
  openApiEnabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  webRoot?: string;
  tlsInspectorUrl?: string;
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
    webRoot: env.GCAC_WEB_ROOT?.trim() || undefined,
    tlsInspectorUrl: env.GCAC_TLS_INSPECTOR_URL?.trim() || undefined,
  };
}
