export const allowedLayerFlow = [
  'Controller -> ApplicationService',
  'ApplicationService -> DomainService',
  'ApplicationService -> Repository',
  'ApplicationService -> QueuePort',
  'ApplicationService -> AuditPort',
] as const;

export const forbiddenLayerFlow = [
  'Controller -> Repository',
  'ModuleAService -> ModuleBPrivateRepository',
  'DomainService -> HttpResponse',
] as const;
