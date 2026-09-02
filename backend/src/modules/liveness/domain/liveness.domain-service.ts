import type { DeviceLivenessSignal, LivenessProjection, LivenessSignalType } from '../schema/liveness.schema.js';
import { isObservationStale, readPositiveSeconds } from '../../../shared/observation-freshness.js';

export interface LivenessProjectionOptions {
  now?: Date;
  staleAfterSeconds?: Partial<Record<LivenessSignalType, number>>;
}

export class LivenessDomainService {
  project(
    signals: DeviceLivenessSignal[],
    requiredSignalTypes: LivenessSignalType[],
    options: LivenessProjectionOptions = {},
  ): LivenessProjection {
    const now = options.now ?? new Date();
    const effectiveSignals = signals.map((signal) => effectiveSignal(signal, staleAfterSeconds(signal.signalType, options), now));
    const requiredSignals = requiredSignalTypes.map((signalType) => {
      return effectiveSignals.find((candidate) => candidate.signalType === signalType);
    });
    const failed = requiredSignals.find((signal) => signal?.status === 'FAILED');
    if (failed) {
      return {
        livenessStatus: 'OFFLINE',
        livenessReasonCode: failed.reasonCode ?? `${failed.signalType}_FAILED`,
        livenessObservedAt: failed.lastObservedAt,
        signals: effectiveSignals,
      };
    }
    const hasMissing = requiredSignals.some((signal) => !signal || signal.status === 'UNKNOWN');
    const missing = requiredSignals.find((signal) => signal?.status === 'UNKNOWN');
    if (hasMissing) {
      return {
        livenessStatus: 'UNKNOWN',
        livenessReasonCode: missing?.reasonCode ?? 'LIVENESS_SIGNAL_MISSING',
        livenessObservedAt: latestObservedAt(signals),
        signals: effectiveSignals,
      };
    }
    if (requiredSignals.every((signal) => signal?.status === 'HEALTHY')) {
      return {
        livenessStatus: 'ONLINE',
        livenessObservedAt: latestObservedAt(requiredSignals.filter((signal): signal is DeviceLivenessSignal => Boolean(signal))),
        signals: effectiveSignals,
      };
    }
    return {
      livenessStatus: 'ONLINE',
      livenessReasonCode: requiredSignals.find((signal) => signal?.status === 'SUSPECT')?.reasonCode ?? 'LIVENESS_OBSERVATION_SUSPECT',
      livenessObservedAt: latestObservedAt(signals),
      signals: effectiveSignals,
    };
  }
}

function effectiveSignal(
  signal: DeviceLivenessSignal,
  staleAfter: number,
  now: Date,
): DeviceLivenessSignal {
  if (signal.status === 'FAILED' || (signal.lastObservedAt && !isObservationStale(signal.lastObservedAt, staleAfter, now))) return signal;
  return { ...signal, status: 'UNKNOWN', reasonCode: signal.reasonCode ?? 'LIVENESS_SIGNAL_STALE' };
}

function staleAfterSeconds(signalType: LivenessSignalType, options: LivenessProjectionOptions): number {
  const configured = options.staleAfterSeconds?.[signalType];
  if (configured && Number.isFinite(configured) && configured > 0) return configured;
  return signalType === 'HEARTBEAT'
    ? readPositiveSeconds('AGENT_OFFLINE_TIMEOUT_SECONDS', 60)
    : readPositiveSeconds('DEVICE_HEALTH_STALE_SECONDS', 60);
}

function latestObservedAt(signals: DeviceLivenessSignal[]): string | undefined {
  return signals
    .map((signal) => signal.lastObservedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}
