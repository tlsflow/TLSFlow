import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const runtimeResourceMappings = Object.freeze([
  ['src/database/migrations', 'dist/database/migrations'],
  ['src/modules/licensing/resources', 'dist/modules/licensing/resources'],
  ['src/modules/plugins/builtin-plugins', 'dist/modules/plugins/builtin-plugins'],
  ['src/modules/workflow-templates/builtin-workflows', 'dist/modules/workflow-templates/builtin-workflows'],
]);

export function copyRuntimeResources(backendRoot, outputRoot = resolve(backendRoot, 'dist')) {
  return runtimeResourceMappings.map(([sourceRelativePath, destinationRelativePath]) => {
    const sourcePath = resolve(backendRoot, sourceRelativePath);
    const destinationPath = resolve(outputRoot, destinationRelativePath.replace(/^dist[\\/]/, ''));
    if (!existsSync(sourcePath)) {
      throw new Error(`运行时资源来源不存在：${sourcePath}`);
    }
    mkdirSync(destinationPath, { recursive: true });
    cpSync(sourcePath, destinationPath, { recursive: true, force: true });
    return destinationPath;
  });
}

function main() {
  const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const destinations = copyRuntimeResources(backendRoot);
  process.stdout.write(`运行时资源已装配：${destinations.join(', ')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
