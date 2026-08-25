-- 凭据检测配置与运行状态共用一对一记录，默认关闭并清理历史自动调度。
alter table credential_health_states
  add column if not exists enabled boolean not null default false,
  add column if not exists selected_device_asset_id text,
  add column if not exists config_version bigint not null default 0,
  add column if not exists updated_by text;

-- 009.6.2 初始实现会为 active 凭据自动创建检测时间；新规则要求管理员显式开启。
update credential_health_states
   set enabled=false,
       selected_device_asset_id=null,
       config_version=0,
       checking_task_id=null,
       next_check_at=null,
       status='DISABLED',
       updated_at=now();

alter table credential_health_states
  drop constraint if exists credential_health_states_enabled_device_check;

alter table credential_health_states
  add constraint credential_health_states_enabled_device_check
  check (not enabled or selected_device_asset_id is not null);

create index if not exists idx_credential_health_states_enabled_due
  on credential_health_states (tenant_id, next_check_at)
  where enabled=true and next_check_at is not null;
