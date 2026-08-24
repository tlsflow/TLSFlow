export interface AlertDispatch {
  ruleId: string;
  status: 'suppressed' | 'queued';
  reason: string;
}

export class AlertDispatcher {
  buildDispatches(ruleIds: string[]): AlertDispatch[] {
    return ruleIds.map((ruleId) => ({
      ruleId,
      status: 'queued',
      reason: '通知通道未接入，已生成待发送告警记录',
    }));
  }
}
