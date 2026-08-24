export interface ModuleMetadata {
  moduleName: string;
  resourcePath: string;
  implementedBySpec: string;
  layers: readonly ['controller', 'application', 'domain', 'repository', 'dto', 'schema'];
}

export function createModuleMetadata(moduleName: string, resourcePath: string, implementedBySpec: string): ModuleMetadata {
  return {
    moduleName,
    resourcePath,
    implementedBySpec,
    layers: ['controller', 'application', 'domain', 'repository', 'dto', 'schema'],
  };
}
