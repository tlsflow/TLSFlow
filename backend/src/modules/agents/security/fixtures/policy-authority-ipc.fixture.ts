let inputBuffer = '';
const mode = process.argv[2];
process.stdin.on('data', (chunk: Buffer) => {
  inputBuffer += chunk.toString('utf8');
  let separator = inputBuffer.indexOf('\n');
  while (separator >= 0) {
    const line = inputBuffer.slice(0, separator).replace(/\r$/, '');
    inputBuffer = inputBuffer.slice(separator + 1);
    if (line.trim()) handle(line);
    separator = inputBuffer.indexOf('\n');
  }
});

function handle(line: string): void {
  try {
    const value = JSON.parse(line) as { requestId: string; method: string };
    const result = { serviceVersion: 'gcac.agent-security/v1', authorityId: 'authority-fixture', activeKeyId: 'key-fixture', keySetIssuedAt: '2026-08-11T00:00:00.000Z' };
    if (mode === 'timeout' && value.method === 'health') return;
    const responseResult = mode === 'wrong-health-version' && value.method === 'health'
      ? { ...result, serviceVersion: 'gcac.agent-security/v0' }
      : result;
    const responseMethod = mode === 'wrong-method' && value.method === 'health' ? 'hello' : value.method;
    process.stdout.write(`${JSON.stringify({ protocolVersion: 'gcac.policy-authority-ipc/v1', requestId: value.requestId, method: responseMethod, ok: true, result: responseResult })}\n`);
    if (value.method === 'shutdown') setImmediate(() => process.exit(0));
  } catch {
    process.exitCode = 2;
  }
}
