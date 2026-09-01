-- 证书通知事件的稳定合同。旧的通用通知记录按创建时间回填，保证历史查询兼容。
ALTER TABLE notification_requests
  ADD COLUMN IF NOT EXISTS event_id text,
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS occurred_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS payload_version integer;

UPDATE notification_requests
   SET event_id = COALESCE(event_id, event_key),
       event_type = COALESCE(event_type, event_key),
       occurred_at = COALESCE(occurred_at, created_at),
       payload_version = COALESCE(payload_version, 1);

ALTER TABLE notification_requests
  ALTER COLUMN event_id SET NOT NULL,
  ALTER COLUMN event_type SET NOT NULL,
  ALTER COLUMN occurred_at SET NOT NULL,
  ALTER COLUMN payload_version SET NOT NULL;

ALTER TABLE notification_requests
  ALTER COLUMN payload_version SET DEFAULT 1;

ALTER TABLE notification_routes
  ADD COLUMN IF NOT EXISTS template_key text;

CREATE INDEX IF NOT EXISTS idx_notification_requests_event_contract
  ON notification_requests (tenant_id, event_type, occurred_at DESC);
