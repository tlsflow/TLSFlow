import { parentPort, workerData } from 'node:worker_threads';
import jsonata from 'jsonata';

interface JsonataWorkerData {
  expression: string;
  input: Record<string, unknown>;
}

const data = workerData as JsonataWorkerData;

try {
  const value = await jsonata(data.expression).evaluate(data.input);
  try {
    parentPort?.postMessage({ ok: true, value });
  } catch (error) {
    parentPort?.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : 'JSONata 输出不可序列化',
    });
  }
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : 'JSONata 表达式执行失败',
  });
}
