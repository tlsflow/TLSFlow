import type { RiskResponseFact, IncidentCertificateFact, AutomationRunFact, AutomationRunTargetFact } from '../domain/report-calculations.js';
import type { ReportQuery } from '../schema/reports.schema.js';

export interface ReportDataPort {
  listIncidentCertificates(query: ReportQuery): Promise<IncidentCertificateFact[]>;
  listRiskResponseFacts(query: ReportQuery): Promise<RiskResponseFact[]>;
  listAutomationRuns(query: ReportQuery): Promise<AutomationRunFact[]>;
  listAutomationTargets(query: ReportQuery): Promise<AutomationRunTargetFact[]>;
}

export class EmptyAutomationReportDataPort implements Pick<ReportDataPort, 'listAutomationRuns' | 'listAutomationTargets'> {
  async listAutomationRuns(): Promise<AutomationRunFact[]> { return []; }
  async listAutomationTargets(): Promise<AutomationRunTargetFact[]> { return []; }
}
