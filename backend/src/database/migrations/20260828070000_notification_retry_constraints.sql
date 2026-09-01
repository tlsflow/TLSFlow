ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_dispatch_generation_check;

ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_dispatch_generation_check
  CHECK (dispatch_generation >= 1);

ALTER TABLE notification_dispatch_outbox
  DROP CONSTRAINT IF EXISTS notification_dispatch_outbox_generation_check;

ALTER TABLE notification_dispatch_outbox
  ADD CONSTRAINT notification_dispatch_outbox_generation_check
  CHECK (dispatch_generation >= 1 AND attempts >= 0);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_failed
  ON notification_deliveries (tenant_id, status, updated_at DESC)
  WHERE status = 'failed';
