-- 通知运行时已支持七类渠道；历史基线仅允许四类。保留未知类型拒绝，避免类型声明与数据库漂移。
ALTER TABLE notification_channels
  DROP CONSTRAINT IF EXISTS notification_channels_type_check;

ALTER TABLE notification_channels
  ADD CONSTRAINT notification_channels_type_check
  CHECK (type = ANY (ARRAY[
    'email'::text,
    'wecom'::text,
    'slack'::text,
    'feishu'::text,
    'dingtalk'::text,
    'telegram'::text,
    'webhook'::text
  ]));
