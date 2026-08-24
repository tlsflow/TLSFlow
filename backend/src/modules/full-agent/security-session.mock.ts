import { REDACTED_VALUE } from '../../common/logging/redact.js';
import type { SecretCleanupReport, SecretSession } from './full-agent.types.js';

export class MockSecretSession implements SecretSession {
  private readonly secrets = new Map<string, string>();
  private tempPlaintextCount = 0;

  put(ref: string, value: string): void {
    this.assertRef(ref);
    this.secrets.set(ref, value);
    this.tempPlaintextCount += 1;
  }

  get(ref: string): string | undefined {
    this.assertRef(ref);
    return this.secrets.get(ref);
  }

  cleanup(): SecretCleanupReport {
    const report = {
      cachedSecretCount: this.secrets.size,
      tempPlaintextCount: this.tempPlaintextCount,
      cleaned: true,
    };
    this.secrets.clear();
    this.tempPlaintextCount = 0;
    return report;
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries([...this.secrets.keys()].map((key) => [key, REDACTED_VALUE]));
  }

  private assertRef(ref: string): void {
    if (!/^secret:[a-zA-Z0-9_.:-]+$/.test(ref)) {
      throw new Error('SecretRef 格式无效，mock 运行时拒绝把明文当引用传递');
    }
  }
}
