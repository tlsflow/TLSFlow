import { AppError } from '../../../common/errors/app-error.js';

export type ConnectionProbeStage = 'ROUTE' | 'TCP' | 'TLS' | 'AUTHENTICATION' | 'PRODUCT_IDENTITY';

export interface PluginConnectionProbeInput {
  host: string;
  port: number;
  gatewayId?: string;
  tls: {
    enabled: boolean;
    verifyCertificate: boolean;
    sniName?: string;
    minimumVersion?: 'TLSv1.2' | 'TLSv1.3';
    caSecretRef?: string;
  };
}

export interface PluginConnectionProbeObservation {
  routeAvailable: boolean;
  tcpConnected: boolean;
  tlsNegotiated?: boolean;
  tlsVersion?: string;
  cipher?: string;
  peerCertificateValid?: boolean;
  authenticated?: boolean;
  productMatched?: boolean;
  errorCode?: string;
}

export interface PluginConnectionProbeResult {
  success: boolean;
  failedStage?: ConnectionProbeStage;
  errorCode?: string;
  riskFlags: Array<'TLS_VERIFICATION_DISABLED' | 'TLS_VERSION_WEAK' | 'CERTIFICATE_INVALID'>;
  stages: Array<{ stage: ConnectionProbeStage; success: boolean; details: Record<string, unknown> }>;
}

export class PluginConnectionProbeService {
  evaluate(input: PluginConnectionProbeInput, observation: PluginConnectionProbeObservation): PluginConnectionProbeResult {
    if (!input.host.trim() || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
      throw new AppError('VALIDATION_FAILED', '连接探测目标不合法');
    }
    const stages: PluginConnectionProbeResult['stages'] = [];
    stages.push(stage('ROUTE', observation.routeAvailable, { gatewayId: input.gatewayId }));
    if (!observation.routeAvailable) return failed('ROUTE', observation.errorCode ?? 'CONNECTION_ROUTE_UNAVAILABLE', [], stages);
    stages.push(stage('TCP', observation.tcpConnected, { host: input.host, port: input.port }));
    if (!observation.tcpConnected) return failed('TCP', observation.errorCode ?? 'CONNECTION_TCP_FAILED', [], stages);

    const riskFlags: PluginConnectionProbeResult['riskFlags'] = [];
    if (input.tls.enabled) {
      if (!input.tls.verifyCertificate) riskFlags.push('TLS_VERIFICATION_DISABLED');
      if (observation.tlsVersion && !['TLSv1.2', 'TLSv1.3'].includes(observation.tlsVersion)) riskFlags.push('TLS_VERSION_WEAK');
      if (observation.peerCertificateValid === false) riskFlags.push('CERTIFICATE_INVALID');
      const tlsSuccess = observation.tlsNegotiated === true && (!input.tls.verifyCertificate || observation.peerCertificateValid === true);
      stages.push(stage('TLS', tlsSuccess, {
        version: observation.tlsVersion,
        cipher: observation.cipher,
        sniName: input.tls.sniName,
        peerCertificateValid: observation.peerCertificateValid,
      }));
      if (!tlsSuccess) return failed('TLS', observation.errorCode ?? 'CONNECTION_TLS_FAILED', riskFlags, stages);
    }

    stages.push(stage('AUTHENTICATION', observation.authenticated === true, {}));
    if (observation.authenticated !== true) return failed('AUTHENTICATION', observation.errorCode ?? 'CONNECTION_AUTH_FAILED', riskFlags, stages);
    stages.push(stage('PRODUCT_IDENTITY', observation.productMatched === true, {}));
    if (observation.productMatched !== true) return failed('PRODUCT_IDENTITY', observation.errorCode ?? 'CONNECTION_PRODUCT_MISMATCH', riskFlags, stages);
    return { success: true, riskFlags, stages };
  }
}

function stage(stageName: ConnectionProbeStage, success: boolean, details: Record<string, unknown>) {
  return { stage: stageName, success, details };
}

function failed(
  failedStage: ConnectionProbeStage,
  errorCode: string,
  riskFlags: PluginConnectionProbeResult['riskFlags'],
  stages: PluginConnectionProbeResult['stages'],
): PluginConnectionProbeResult {
  return { success: false, failedStage, errorCode, riskFlags, stages };
}
