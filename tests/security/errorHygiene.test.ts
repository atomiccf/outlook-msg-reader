import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMsg } from '../../src';
import { readAt } from '../../src/cfb/InputSource';

function leakPatterns(): string[] {
  return [process.cwd(), tmpdir(), 'file://'];
}

function assertNoPathLeak(message: string): void {
  for (const pattern of leakPatterns()) {
    expect(message.includes(pattern), `error leaked ${JSON.stringify(pattern)}`).toBe(false);
  }
  expect(message, 'error leaked a Windows drive path').not.toMatch(/[A-Za-z]:\\/);
}

describe('error hygiene', () => {
  it('does not leak cwd, tmpdir, drive letters, or file URLs for a missing absolute path', async () => {
    await expect(parseMsg('C:\\does-not-exist\\secret.msg')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      assertNoPathLeak((error as Error).message);
      return true;
    });
  });

  it('does not leak cwd, tmpdir, drive letters, or file URLs for a missing relative path', async () => {
    await expect(parseMsg(path.join('does-not-exist', 'secret.msg'))).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      assertNoPathLeak((error as Error).message);
      return true;
    });
  });

  it('readAt copies an in-range slice without extra bytes', async () => {
    const buffer = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const offset = 2;
    const length = 3;
    const slice = await readAt(buffer, offset, length);
    expect(slice.length).toBe(length);
    expect(slice.equals(buffer.subarray(offset, offset + length))).toBe(true);
  });

  it('readAt past the end of a buffer returns a shorter slice and does not throw', async () => {
    const buffer = Buffer.from([1, 2, 3, 4]);
    const slice = await readAt(buffer, 2, 8);
    expect(slice.length).toBeLessThan(8);
    expect(slice.equals(buffer.subarray(2, 10))).toBe(true);
  });
});
