import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const flue = spawn(process.execPath, [resolve(root, 'flue/dist/server.mjs')], {
  env: { ...process.env, PORT: process.env.FLUE_PORT ?? '4291' },
  stdio: 'inherit',
});

const stop = () => {
  if (!flue.killed) flue.kill('SIGTERM');
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
flue.once('exit', (code, signal) => {
  if (code !== 0 && signal !== 'SIGTERM') {
    console.error(`[flue] exited with ${code ?? signal ?? 'unknown'}`);
  }
});

await import('./index.ts');
const { startScheduler } = await import('./scheduler.ts');
const stopScheduler = startScheduler();
process.once('SIGINT', stopScheduler);
process.once('SIGTERM', stopScheduler);
