import type { DeviceLivenessSignal, LivenessProjection, LivenessSignalType } from '../schema/liveness.schema.js';

export class LivenessDomainService {
  project(signals: DeviceLivenessSignal[], requiredSignalTypes: LivenessSignalType[]): LivenessProjection {
    const requiredSignals = requiredSignalTypes.map((signalType) => signals.find((signal) => signal.signalType === signalType));
    const failed = requiredSignals.find((signal) => signal?.status === 'FAILED');
    if (failed) {
      return {
        livenessStatus: 'OFFLINE',
        livenessReasonCode: failed.reasonCode ?? `${failed.signalType}_FAILED`,
        livenessObservedAt: failed.lastObservedAt,
        signals,
      };
    }
    const hasMissing = requiredSignals.some((signal) => !signal || signal.status === 'UNKNOWN');
    const missing = requiredSignals.find((signal) => signal?.status === 'UNKNOWN');
    if (hasMissing) {
      return {
        livenessStatus: 'UNKNOWN',
        livenessReasonCode: missing?.reasonCode ?? 'LIVENESS_SIGNAL_MISSING',
        livenessObservedAt: latestObservedAt(signals),
        signals,
      };
    }
    if (requiredSignals.every((signal) => signal?.status === 'HEALTHY')) {
      return {
        livenessStatus: 'ONLINE',
        livenessObservedAt: latestObservedAt(requiredSignals.filter((signal): signal is DeviceLivenessSignal => Boolean(signal))),
        signals,
      };
    }
    return {
      livenessStatus: 'ONLINE',
      livenessReasonCode: requiredSignals.find((signal) => signal?.status === 'SUSPECT')?.reasonCode ?? 'LIVENESS_OBSERVATION_SUSPECT',
      livenessObservedAt: latestObservedAt(signals),
      signals,
    };
  }
}

function latestObservedAt(signals: DeviceLivenessSignal[]): string | undefined {
  return signals
    .map((signal) => signal.lastObservedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}
