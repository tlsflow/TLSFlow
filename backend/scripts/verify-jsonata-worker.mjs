import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const jsonataWorkerRelativePath = 'dist/modules/workflow-templates/domain/jsonata-transform.worker.js';

export function jsonataWorkerPath(backendRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))) {
  return resolve(backendRoot, jsonataWorkerRelativePath);
}

export function assertJsonataWorkerArtifact(backendRoot) {
  const artifactPath = jsonataWorkerPath(backendRoot);
  if (!existsSync(artifactPath)) {
    throw new Error(`JSONata Worker 编译产物缺失：${artifactPath}；请先执行 npm run build`);
  }
  return artifactPath;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const backendRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  console.log(`JSONata Worker 编译产物已确认：${assertJsonataWorkerArtifact(backendRoot)}`);
}
