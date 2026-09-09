---
title: Reports
description: View certificate incident windows, risk response, and automation effectiveness reports
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - backend/src/modules/reports/controller/reports.controller.ts
  - backend/src/modules/reports
  - web/src/router/modules/business.ts
testRefs: []
lastVerified: 2026-08-22
---

# Reports

Reports summarize certificate, risk and automation data in filterable, downloadable views for weekly reviews, incident retrospectives and risk tracking. They are statistical views and do not replace individual execution records, audit records or live site measurements.

## Selecting Reports

Currently, three types of reports are available:

| Report | Suitable for Answering Questions |
| --- | --- |
| Certificate Incident Windows | Which certificates are about to expire or have expired? Are replacement certificates, deployment plans, or execution channels missing? |
| Risk Handling | Are risks being confirmed and resolved promptly? Are there cases of reopening or exceeding handling time limits? |
| Automation Effectiveness | What are the success rates of automation runs and targets? Which stage do failures concentrate in? Are there retries, rollbacks, or manual interventions? |

Open the corresponding page from **Monitoring → Reports**.

## Setting Time Range and Filters

1. At the top of the page, select "Last 7 Days", "Last 30 Days", or "Last 90 Days". After switching ranges, the system will automatically reload data.
2. In the filter section, fill in common conditions such as environment, owner, application asset, tags, etc.
3. Risk handling reports can also filter by severity and risk type.
4. Automation effectiveness reports can also filter by automation ID and failure stage (target selection, plan creation, approval, execution, verification, rollback, or notification).
5. Click "Apply Filters" to view results; click "Reset Filters" when needing to start over.


## Reading Report Results

1. First look at metric cards to understand total count, success rate, overdue count, or average handling duration. Click a metric card to drill down into objects for that metric.
2. In "Historical Trends", view daily snapshot counts and data completeness. When displaying "Incomplete", treat it as a data range reminder first; do not directly compare with complete periods.
3. In "Group Comparison", compare counts by environment, owner, severity, risk type, or failure stage to identify groups requiring priority attention.
4. In "Object Drill-Down", view specific certificates, assets, automation runs, or deployment plans. Times in the table are displayed in browser local time.


## Exporting and Archiving

1. After confirming filters and metrics match the current reporting scope, click "Export CSV" in the upper right corner.
2. After generation completes, click "Download" in export history to save the file; in-progress records show queued or processing status.
3. When export fails or has expired, first confirm time range and filters, then regenerate; do not treat failed files as official data.
4. For reconciliation or audits, save both report execution records and CSV files together for convenient traceability of statistical criteria.


## Usage Boundaries

Reports are summaries generated based on selected time and filter conditions and do not modify certificate, risk, or automation status. When discovering anomalous numbers, return to corresponding execution records, monitoring detection history, or audit logs to verify original facts. The narrower the time range and filter conditions, the more suitable the results for problem identification; before external reporting, clarify the statistical period and scope.
