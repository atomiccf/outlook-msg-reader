import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const worker = path.resolve(import.meta.dirname, 'helpers/oomWorker.mjs');
const cwd = path.resolve(import.meta.dirname, '../..');
const heapTimeoutMs = 30_000;
const parseTimeoutMs = 15_000;

export interface HeapExhaustionResult {
  exit: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  elapsed: number;
}

export function expectHeapExhaustion(result: HeapExhaustionResult): void {
  if (result.signal === 'SIGKILL' || result.elapsed >= heapTimeoutMs) {
    throw new Error(`child timed out (${result.elapsed}ms)`);
  }
  if (result.exit === 0) {
    throw new Error('child exited 0; heap was not exhausted');
  }
  if (result.exit === null && result.signal !== 'SIGABRT') {
    throw new Error(`child terminated with unexpected signal: ${result.signal}`);
  }
  if (!/FATAL ERROR:[^\r\n]*heap out of memory/i.test(result.stderr)) {
    throw new Error(`stderr did not report heap exhaustion: ${result.stderr.slice(0, 500)}`);
  }
}

async function runWorker(
  args: string[],
  killAfterMs: number,
): Promise<HeapExhaustionResult> {
  const started = Date.now();
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), killAfterMs);
  try {
    const result = await new Promise<Pick<HeapExhaustionResult, 'exit' | 'signal'>>((resolve, reject) => {
      child.once('close', (exit, signal) => resolve({ exit, signal }));
      child.once('error', reject);
    });
    return { ...result, stderr, elapsed: Date.now() - started };
  } finally {
    clearTimeout(timeout);
  }
}

describe('worker OOM isolation', () => {
  it('accepts confirmed OOM on Windows and Unix and rejects other outcomes', () => {
    const oom = { stderr: 'FATAL ERROR: JavaScript heap out of memory', elapsed: 100 };
    expect(() => expectHeapExhaustion({ ...oom, exit: 1, signal: null })).not.toThrow();
    expect(() => expectHeapExhaustion({ ...oom, exit: null, signal: 'SIGABRT' })).not.toThrow();
    expect(() => expectHeapExhaustion({ ...oom, exit: 0, signal: null })).toThrow('exited 0');
    expect(() => expectHeapExhaustion({ ...oom, exit: null, signal: 'SIGKILL' })).toThrow('timed out');
    expect(() => expectHeapExhaustion({ ...oom, exit: null, signal: null })).toThrow('unexpected signal');
    expect(() => expectHeapExhaustion({ ...oom, exit: 1, signal: null, elapsed: heapTimeoutMs })).toThrow('timed out');
    expect(() => expectHeapExhaustion({ ...oom, exit: null, signal: 'SIGABRT', stderr: 'FATAL ERROR: unrelated' }))
      .toThrow('stderr did not report heap exhaustion');
  });

  it('heap-bomb exhausts the V8 heap without hanging the parent', async () => {
    const result = await runWorker(['--max-old-space-size=64', worker, 'heap-bomb'], heapTimeoutMs);
    expectHeapExhaustion(result);
  }, heapTimeoutMs + 5_000);

  it('parse mode completes a valid rtf-unicode fixture', async () => {
    const result = await runWorker([worker, 'parse'], parseTimeoutMs);
    expect(result.exit, result.stderr).toBe(0);
    expect(result.elapsed).toBeLessThan(parseTimeoutMs);
  }, parseTimeoutMs + 5_000);
});
