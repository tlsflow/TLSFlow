import { createHash } from 'node:crypto';
import type { AgentCapabilitySnapshot } from '../agents/schema/agents.schema.js';
import type { CapabilityDetectorFixture, DetectedCapabilities, FullAgentConfig } from './full-agent.types.js';

function capability(capabilityKey: string, value: unknown, confidence = 1, evidence: Record<string, unknown> = {}) {
  return { capabilityKey, value, confidence, evidence };
}

export class CapabilityDetector {
  detect(config: FullAgentConfig, fixture: CapabilityDetectorFixture = {}): DetectedCapabilities {
    const osType = fixture.osType ?? config.osType;
    const arch = fixture.arch ?? config.arch;
    const runtime = fixture.runtime ?? 'node';
    const capabilities: AgentCapabilitySnapshot['capabilities'] = [
      capability('host.os', osType, 1, { source: fixture.osType ? 'fixture' : 'config' }),
      capability('host.arch', arch, 1, { source: fixture.arch ? 'fixture' : 'config' }),
      capability('process.exec', fixture.processExec ?? false, 0.9, { mode: 'mock' }),
      capability('file.write', fixture.fileWrite ?? false, 0.9, { mode: 'mock' }),
      capability('service.control', fixture.serviceControl ?? false, 0.8, { mode: 'mock' }),
      capability('fullagent.runtime', runtime, 1, { version: config.version, alias: 'full_agent.runtime' }),
    ];
    capabilities.push(...(fixture.extraCapabilities ?? []).map((item) => ({
      capabilityKey: item.capabilityKey,
      value: item.value,
      confidence: item.confidence ?? 0.8,
      evidence: item.evidence,
    })));

    const capabilityVersion = createHash('sha256')
      .update(JSON.stringify({ seed: config.capabilityVersionSeed ?? 'full-agent-v1', capabilities }))
      .digest('hex')
      .slice(0, 16);

    return {
      capabilityVersion,
      compatibilityLevel: fixture.processExec && fixture.fileWrite && fixture.serviceControl ? 'L4' : 'L3',
      capabilities,
    };
  }
}
