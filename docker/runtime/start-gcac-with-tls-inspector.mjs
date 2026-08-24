import { spawn } from 'node:child_process';

const tlsInspectorEntry = '/opt/gcac/tls-inspector/src/index.js';
const children = [
  startChild('tls-inspector', process.execPath, [tlsInspectorEntry]),
  startChild('backend', 'npm', ['start']),
];

let stopping = false;
let exitCode = 0;
let remaining = children.length;

for (const child of children) {
  child.process.once('error', (error) => {
    if (stopping) return;
    process.stderr.write(`[runtime] ${child.name} 无法启动：${error.message}\n`);
    requestShutdown(1);
  });
  child.process.once('close', (code, signal) => {
    remaining -= 1;
    if (!stopping) {
      const childExitCode = code === 0 && !signal ? 1 : code ?? 1;
      process.stderr.write(`[runtime] ${child.name} 意外退出（code=${code ?? 'null'} signal=${signal ?? 'null'}）\n`);
      requestShutdown(childExitCode);
    }
    if (remaining === 0) process.exitCode = exitCode;
  });
}

process.once('SIGINT', () => requestShutdown(0));
process.once('SIGTERM', () => requestShutdown(0));

function startChild(name, command, args) {
  return {
    name,
    process: spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
    }),
  };
}

function requestShutdown(nextExitCode) {
  if (stopping) return;
  stopping = true;
  exitCode = nextExitCode;
  for (const child of children) {
    if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill('SIGTERM');
  }
  const forceKillTimer = setTimeout(() => {
    for (const child of children) {
      if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill('SIGKILL');
    }
  }, 10_000);
  forceKillTimer.unref();
}
