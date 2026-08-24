import { parentPort, workerData } from 'node:worker_threads';
import { createHash, X509Certificate } from 'node:crypto';
import jsonata from 'jsonata';

interface JsonataWorkerData {
  expression: string;
  input: Record<string, unknown>;
}

const data = workerData as JsonataWorkerData;

if (!parentPort) throw new Error('JSONata Worker 缺少 parentPort');
const port = parentPort;
port.postMessage({ type: 'ready' });
await new Promise<void>((resolve) => {
  const handleMessage = (message: { type?: string }) => {
    if (message?.type !== 'start') return;
    port.off('message', handleMessage);
    resolve();
  };
  port.on('message', handleMessage);
});
port.postMessage({ type: 'started' });

// 让宿主先收到 started 并启动执行计时器，避免重计算抢在超时计时器之前完成消息投递。
await new Promise<void>((resolve) => setImmediate(resolve));
const executionStartedAt = performance.now();
try {
  const expression = jsonata(data.expression);
  expression.registerFunction('x509Sha256', x509Sha256, '<s:s>');
  const value = await expression.evaluate(data.input);
  try {
    port.postMessage({ type: 'result', ok: true, value, durationMs: performance.now() - executionStartedAt });
  } catch (error) {
    port.postMessage({
      type: 'result',
      ok: false,
      message: error instanceof Error ? error.message : 'JSONata 输出不可序列化',
      durationMs: performance.now() - executionStartedAt,
    });
  }
} catch (error) {
  port.postMessage({
    type: 'result',
    ok: false,
    message: error instanceof Error ? error.message : 'JSONata 表达式执行失败',
    durationMs: performance.now() - executionStartedAt,
  });
}

function x509Sha256(base64FileContent: string): string {
  const certificate = new X509Certificate(Buffer.from(base64FileContent.replace(/\s/g, ''), 'base64'));
  return createHash('sha256').update(certificate.raw).digest('hex');
}
