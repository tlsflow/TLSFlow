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
  port.once('message', (message: { type?: string }) => {
    if (message?.type === 'start') resolve();
  });
});
port.postMessage({ type: 'started' });

try {
  const expression = jsonata(data.expression);
  expression.registerFunction('x509Sha256', x509Sha256, '<s:s>');
  const value = await expression.evaluate(data.input);
  try {
    port.postMessage({ type: 'result', ok: true, value });
  } catch (error) {
    port.postMessage({
      type: 'result',
      ok: false,
      message: error instanceof Error ? error.message : 'JSONata 输出不可序列化',
    });
  }
} catch (error) {
  port.postMessage({
    type: 'result',
    ok: false,
    message: error instanceof Error ? error.message : 'JSONata 表达式执行失败',
  });
}

function x509Sha256(base64FileContent: string): string {
  const certificate = new X509Certificate(Buffer.from(base64FileContent.replace(/\s/g, ''), 'base64'));
  return createHash('sha256').update(certificate.raw).digest('hex');
}
