-- 旧库已由早期 20260828060000 内容创建该约束；新库必须通过后续迁移获得相同保护。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'notification_dispatch_outbox'::regclass
      AND conname = 'notification_dispatch_outbox_generation_check'
  ) THEN
    ALTER TABLE notification_dispatch_outbox
      ADD CONSTRAINT notification_dispatch_outbox_generation_check
      CHECK (dispatch_generation >= 1 AND attempts >= 0);
  END IF;
END $$;
