export type LivenessResourceType = 'AGENT' | 'DEVICE';
export type LivenessSignalType = 'HEARTBEAT' | 'MANAGEMENT_TCP';
export type LivenessSignalStatus = 'UNKNOWN' | 'HEALTHY' | 'SUSPECT' | 'FAILED';
export type LivenessStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
export type LivenessSignalSource = 'AGENT' | 'CONTROL_PLANE' | 'GATEWAY';

export interface DeviceLivenessSignal {
  id: string;
  tenantId: string;
  resourceType: LivenessResourceType;
  resourceId: string;
  signalType: LivenessSignalType;
  required: boolean;
  status: LivenessSignalStatus;
  consecutiveFailures: number;
  lastObservedAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  endpointHost?: string;
  endpointPort?: number;
  source: LivenessSignalSource;
  reasonCode?: string;
  reasonDetail?: string;
  observationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LivenessProjection {
  livenessStatus: LivenessStatus;
  livenessReasonCode?: string;
  livenessObservedAt?: string;
  signals: DeviceLivenessSignal[];
}
