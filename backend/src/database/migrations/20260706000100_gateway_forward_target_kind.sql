alter table execution_targets drop constraint if exists execution_targets_target_kind_check;

alter table execution_targets
  add constraint execution_targets_target_kind_check
  check (target_kind in ('AGENT', 'GATEWAY_FORWARD', 'SSH', 'WINRM', 'SMB_WMI', 'CURL', 'WORKFLOW', 'SCRIPT_PACKAGE'));
