import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CorruptedSectorChainError, MsgError, createMsgReader, parseMsg, type MsgReaderOptions } from '../../src';
import { loadFixture } from './helpers/fixtures';
import { expectControlledFailure } from './helpers/expectations';

const OPTIONS = [
  'maxInputBytes',
  'maxResultBytes',
  'maxRtfBytes',
  'maxAttachments',
  'maxRecipients',
  'maxAttachmentBytes',
  'maxEmbeddedMessageDepth',
  'maxDirectoryDepth',
  'maxDirectoryBytes',
  'streamMemoryThreshold',
] as const;

type LimitName = (typeof OPTIONS)[number];

function fixture(id = 'plain-basic-unicode'): Buffer {
  return loadFixture(id);
}

function constant(value: number): (buf: Buffer) => number {
  return () => value;
}

describe('limits and abort', () => {
  it.each(OPTIONS)('rejects -1, NaN, Infinity, and 1.5 for %s', async (name: LimitName) => {
    const buf = fixture();
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      const options = { [name]: value } as MsgReaderOptions;
      const run = name === 'streamMemoryThreshold'
        ? () => parseMsg(Readable.from([buf]), options)
        : () => parseMsg(buf, options);
      const error = await expectControlledFailure(run, [RangeError], 2000);
      expect(error).toBeInstanceOf(RangeError);
      expect(error?.message).toContain(name);
    }
  });

  it.each([
    { name: 'maxInputBytes' as const, expected: RangeError, ok: (buf: Buffer) => buf.length, bad: (buf: Buffer) => buf.length - 1 },
    { name: 'maxResultBytes' as const, expected: RangeError, ok: constant(256 * 1024 * 1024), bad: constant(0) },
    { name: 'maxRtfBytes' as const, expected: RangeError, ok: constant(64 * 1024 * 1024), bad: constant(0), id: 'rtf-unicode' },
    { name: 'maxAttachments' as const, expected: RangeError, ok: constant(1000), bad: constant(0), id: 'small-attachment' },
    { name: 'maxRecipients' as const, expected: RangeError, ok: constant(1000), bad: constant(0), id: 'plain-basic-unicode' },
    { name: 'maxAttachmentBytes' as const, expected: RangeError, ok: constant(64 * 1024 * 1024), bad: constant(0), id: 'small-attachment' },
    { name: 'maxEmbeddedMessageDepth' as const, expected: RangeError, ok: constant(16), bad: constant(0), id: 'embedded-message' },
    { name: 'maxDirectoryDepth' as const, expected: CorruptedSectorChainError, ok: constant(128), bad: constant(0) },
    { name: 'maxDirectoryBytes' as const, expected: RangeError, ok: constant(32 * 1024 * 1024), bad: constant(64) },
  ])('$name succeeds on the configured boundary and fails past it', async ({ name, expected, ok, bad, id }) => {
    const buf = fixture(id);
    const success = await parseMsg(buf, { [name]: ok(buf) } as MsgReaderOptions);
    expect(success).toBeTruthy();
    const run = name === 'maxEmbeddedMessageDepth'
      ? async () => {
        const reader = await createMsgReader(buf, { maxEmbeddedMessageDepth: bad(buf) });
        try {
          await reader.getEmbeddedMessage(0);
        } finally {
          await reader.close();
        }
      }
      : () => parseMsg(buf, { [name]: bad(buf) } as MsgReaderOptions);
    const error = await expectControlledFailure(run, [expected], 2000);
    expect(error).toBeInstanceOf(expected);
  });

  it('accepts streamMemoryThreshold: 0 as a valid value', async () => {
    const buf = fixture();
    const buffered = await parseMsg(buf);
    const streamed = await parseMsg(Readable.from([buf]), { streamMemoryThreshold: 0 });
    expect(streamed.subject).toBe(buffered.subject);
  });

  it('rejects an already aborted signal before parsing', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await expectControlledFailure(
      () => parseMsg(fixture(), { signal: controller.signal }),
      [Error, MsgError],
      2000,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.name).toMatch(/AbortError|Abort/);
  });

  it('aborts while reading a streamed fixture and closes the reader', async () => {
    const buf = fixture();
    const controller = new AbortController();
    const stream = new Readable({
      read() {
        this.push(buf.subarray(0, 512));
        controller.abort();
        this.push(buf.subarray(512));
        this.push(null);
      },
    });
    const pending = createMsgReader(stream, { signal: controller.signal, streamMemoryThreshold: 256 });
    await expect(pending).rejects.toMatchObject({ name: expect.stringMatching(/Abort/) });
  });
});
