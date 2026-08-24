export type DatabaseBackend = 'memory' | 'pglite' | 'postgres';

export interface DatabaseConfig {
  backend: DatabaseBackend;
  postgresUrl?: string;
  migrationsDir: string;
}

export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const backend = readBackend(env);
  const host = env.GCAC_DATABASE_HOST?.trim();
  const port = env.GCAC_DATABASE_PORT?.trim() || '5432';
  const user = env.GCAC_DATABASE_USER?.trim();
  const password = env.GCAC_DATABASE_PASSWORD ?? '';
  const database = env.GCAC_DATABASE_NAME?.trim();
  const postgresUrl = env.GCAC_DATABASE_URL?.trim()
    || (host && user && database ? `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}` : undefined);

  return {
    backend,
    postgresUrl,
    migrationsDir: env.GCAC_MIGRATIONS_DIR?.trim() || 'src/database/migrations',
  };
}

function readBackend(env: NodeJS.ProcessEnv): DatabaseBackend {
  const configured = env.GCAC_PERSISTENCE_BACKEND?.trim().toLowerCase();
  if (configured === 'memory' || configured === 'pglite' || configured === 'postgres') return configured;
  if (env.NODE_TEST_CONTEXT) return 'pglite';
  return 'postgres';
}
