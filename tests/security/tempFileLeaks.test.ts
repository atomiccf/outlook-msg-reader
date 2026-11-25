import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { MsgError, createMsgReader, parseMsg } from '../../src';
import { expectControlledFailure } from './helpers/expectations';
import { loadFixture } from './helpers/fixtures';

const PREFIX = 'msg-js-';

function msgTempDirs(): Set<string> {
  return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith(PREFIX)));
}

async function expectNoNewTempDirs(before: Set<string>): Promise<void> {
  await vi.waitFor(() => {
    const leaked = [...msgTempDirs()].filter((name) => !before.has(name));
    expect(leaked).toEqual([]);
  }, { timeout: 2000, interval: 50 });
}

describe('temporary file leaks', () => {
  it('removes msg-js temp directories after parse errors', async () => {
    const before = msgTempDirs();
    for (let round = 0; round < 5; round += 1) {
      const garbage = Readable.from([Buffer.alloc(4096, 0x41)]);
      await expectControlledFailure(
        () => parseMsg(garbage, { streamMemoryThreshold: 1024 }),
        [MsgError, RangeError],
        2000,
      );
    }
    await expectNoNewTempDirs(before);
  });

  it('removes msg-js temp directories after abort', async () => {
    const before = msgTempDirs();
    const controller = new AbortController();
    const chunks = [Buffer.alloc(2048, 0x42), Buffer.alloc(2048, 0x43)];
    const stream = new Readable({
      read() {
        const chunk = chunks.shift();
        if (chunk) {
          this.push(chunk);
          controller.abort();
          return;
        }
        this.push(null);
      },
    });
    await expectControlledFailure(
      () => parseMsg(stream, { streamMemoryThreshold: 1024, signal: controller.signal }),
      [Error, MsgError, RangeError],
      2000,
    );
    await expectNoNewTempDirs(before);
  });

  it('removes the msg-js directory created for a spilled valid stream after close', async () => {
    const before = msgTempDirs();
    const buf = loadFixture('plain-basic-unicode');
    expect(buf.length).toBeGreaterThan(2048);
    const reader = await createMsgReader(Readable.from([buf]), { streamMemoryThreshold: 1024 });
    try {
      const afterOpen = [...msgTempDirs()].filter((name) => !before.has(name));
      expect(afterOpen.length).toBeGreaterThan(0);
    } finally {
      await reader.close();
    }
    await expectNoNewTempDirs(before);
  });
});
