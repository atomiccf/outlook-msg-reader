import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const worker = path.resolve(import.meta.dirname, 'helpers/oomWorker.mjs');
const cwd = path.resolve(import.meta.dirname, '../..');

export interface HeapExhaustionResult {
  exit: number | null;
  stderr: string;
  elapsed: number;
}

export function expectHeapExhaustion(result: HeapExhaustionResult): void {
  if (result.exit === null) {
    throw new Error('child did not exit; hang not detected');
  }
  if (result.exit === 0) {
    throw new Error('child exited 0; heap was not exhausted');
  }
  if (result.elapsed >= 30_000) {
    throw new Error(`child ran too long (${result.elapsed}ms)`);
  }
  if (!/heap out of memory|Allocation failed|FATAL ERROR/i.test(result.stderr)) {
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
  const exit = await new Promise<number | null>((resolve) => {
    child.on('exit', (code) => resolve(code));
  });
  clearTimeout(timeout);
  return { exit, stderr, elapsed: Date.now() - started };
}

describe('worker OOM isolation', () => {
  it('expectHeapExhaustion accepts OOM and rejects success or hang', () => {
    expect(() => expectHeapExhaustion({
      exit: 1,
      stderr: 'FATAL ERROR: JavaScript heap out of memory',
      elapsed: 100,
    })).not.toThrow();
    expect(() => expectHeapExhaustion({
      exit: 0,
      stderr: 'FATAL ERROR: JavaScript heap out of memory',
      elapsed: 100,
    })).toThrow();
    expect(() => expectHeapExhaustion({
      exit: null,
      stderr: 'FATAL ERROR: JavaScript heap out of memory',
      elapsed: 100,
    })).toThrow();
  });

  it('heap-bomb exhausts the V8 heap without hanging the parent', async () => {
    const result = await runWorker(['--max-old-space-size=64', worker, 'heap-bomb'], 30_000);
    if (result.exit === null) {
      expect.fail('child did not exit; hang not detected');
    }
    expectHeapExhaustion(result);
  });

  it('parse mode completes a valid rtf-unicode fixture', async () => {
    const result = await runWorker([worker, 'parse'], 15_000);
    if (result.exit === null) {
      expect.fail('child did not exit; hang not detected');
    }
    expect(result.exit).toBe(0);
    expect(result.elapsed).toBeLessThan(15_000);
  });
});
