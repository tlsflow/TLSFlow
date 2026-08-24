import type { App } from '../common/http/app.js';
import type { RouteContract } from '../common/openapi/route-contract.js';
import type { DatabasePort } from '../database/database-port.js';
import type { AuditService } from '../modules/audits/audit.service.js';
import { createDefaultLicensingService, getLicensingRouteContracts, LicensingController } from '../modules/licensing/index.js';

export function registerEditionLicensing(app: App, db: DatabasePort, audit?: AuditService): void {
  const licensingService = createDefaultLicensingService(db, audit);
  app.setResource('licensingService', licensingService);
  new LicensingController(licensingService).register(app.router);
}

export function getEditionLicensingRouteContracts(): RouteContract[] {
  return getLicensingRouteContracts();
}
