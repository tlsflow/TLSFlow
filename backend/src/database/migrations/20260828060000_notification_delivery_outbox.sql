-- Delivery 与 Outbox 同事务创建。任务队列短暂不可用时，补偿器仍可以从 Outbox 恢复派发。
ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS template_version integer,
  ADD COLUMN IF NOT EXISTS dispatch_generation integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS dispatch_task_id text,
  ADD COLUMN IF NOT EXISTS last_retry_at timestamp with time zone;

CREATE TABLE IF NOT EXISTS notification_dispatch_outbox (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  delivery_id text NOT NULL REFERENCES notification_deliveries(id) ON DELETE CASCADE,
  dispatch_generation integer NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamp with time zone,
  task_id text,
  last_error text,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  CONSTRAINT notification_dispatch_outbox_status_check
    CHECK (status = ANY (ARRAY['queued'::text, 'dispatching'::text, 'dispatched'::text, 'failed'::text]))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_dispatch_outbox_generation
  ON notification_dispatch_outbox (tenant_id, delivery_id, dispatch_generation);

CREATE INDEX IF NOT EXISTS idx_notification_dispatch_outbox_worker
  ON notification_dispatch_outbox (status, next_attempt_at, lease_until, created_at);

-- 历史版本已经存在的 queued/retrying 投递也必须进入补偿队列，避免升级后成为孤儿记录。
INSERT INTO notification_dispatch_outbox (
  id, tenant_id, delivery_id, dispatch_generation, status, next_attempt_at, created_at, updated_at
)
SELECT
  'nob_' || d.id || '_' || d.dispatch_generation,
  d.tenant_id,
  d.id,
  d.dispatch_generation,
  'queued',
  COALESCE(d.next_attempt_at, now()),
  now(),
  now()
FROM notification_deliveries d
WHERE d.status IN ('queued', 'retrying')
ON CONFLICT (tenant_id, delivery_id, dispatch_generation) DO NOTHING;
