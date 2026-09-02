import type { AutomationTriggerDto } from '../dto/automations.dto.js';

export function cronMatches(cron: string, date: Date, timeZone: string): boolean {
  const fields = cron.trim().split(/\s+/).map((field) => field.split(','));
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', minute: '2-digit', hour: '2-digit', day: '2-digit', month: '2-digit', weekday: 'short' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const local = [Number(values.minute), Number(values.hour), Number(values.day), Number(values.month), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday)];
  return fields.every((field, index) => field.some((value) => cronFieldMatches(value, local[index]!, index)));
}

function cronFieldMatches(field: string, value: number, index: number): boolean {
  if (field === '*') return true;
  if (field.startsWith('*/')) return value % Number(field.slice(2)) === 0;
  if (field.includes('-')) { const [start, end] = field.split('-').map(Number); return value >= start && value <= end; }
  return Number(field) === value || (index === 3 && Number(field) === value);
}

export function nextCronOccurrence(trigger: Extract<AutomationTriggerDto, { type: 'schedule' }>, from: Date): Date | undefined {
  const startsAt = trigger.startsAt ? new Date(trigger.startsAt) : undefined;
  const endsAt = trigger.endsAt ? new Date(trigger.endsAt) : undefined;
  const searchFrom = startsAt && startsAt > from ? startsAt : from;
  const candidate = new Date(searchFrom.getTime() + 60_000 - (searchFrom.getTime() % 60_000));
  for (let index = 0; index < 366 * 24 * 60; index += 1) {
    const current = new Date(candidate.getTime() + index * 60_000);
    if (endsAt && current > endsAt) return undefined;
    if (cronMatches(trigger.cron, current, trigger.timeZone)) return current;
  }
  return undefined;
}

export function nextAutomationRunAt(trigger: AutomationTriggerDto, from: Date): string | undefined {
  if (trigger.type === 'once') return new Date(trigger.runAt).toISOString();
  if (trigger.type === 'schedule') return nextCronOccurrence(trigger, from)?.toISOString();
  return undefined;
}

/** 计算证书事件后的下一个本地部署时刻，跨时区和夏令时均以浏览器/Node 时区数据库为准。 */
export function nextCertificateDeploymentAt(
  trigger: Extract<AutomationTriggerDto, { type: 'certificate_version_created' }>,
  from: Date,
): Date | undefined {
  const schedule = trigger.deploymentSchedule;
  if (!schedule) return undefined;
  const start = new Date(Math.ceil(from.getTime() / 60_000) * 60_000);
  for (let index = 0; index <= 3 * 24 * 60; index += 1) {
    const candidate = new Date(start.getTime() + index * 60_000);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: schedule.timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(candidate);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (Number(values.hour) === schedule.hour && Number(values.minute) === schedule.minute && candidate.getTime() >= from.getTime()) return candidate;
  }
  return undefined;
}
