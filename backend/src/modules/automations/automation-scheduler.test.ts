import assert from 'node:assert/strict';
import test from 'node:test';
import { cronMatches, nextCronOccurrence } from './application/automation-scheduler.js';

test('Cron 按目标时区匹配并计算下一次触发', () => {
  const trigger = { type: 'schedule' as const, cron: '0 9 * * 1-5', timeZone: 'Asia/Shanghai' };
  const now = new Date('2026-07-20T00:00:00.000Z');
  assert.equal(cronMatches(trigger.cron, new Date('2026-07-20T01:00:00.000Z'), trigger.timeZone), true);
  assert.equal(nextCronOccurrence(trigger, now)?.toISOString(), '2026-07-20T01:00:00.000Z');
});

test('不合法时区由 Intl 直接拒绝', () => {
  assert.throws(() => cronMatches('0 0 * * *', new Date(), 'Invalid/Zone'));
});
