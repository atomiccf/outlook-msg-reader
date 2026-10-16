import { describe, expect, it } from 'vitest';
import type { CFBFReader } from '../src/cfb/CFBReader';
import { PropertyStreamReader } from '../src/mapi/PropertyStreamReader';

function createRootPropertyStream(padding: Buffer): Buffer {
  const headerSize = 32;
  const entrySize = 16;
  const stream = Buffer.alloc(headerSize + entrySize + padding.length);
  stream.writeUInt16LE(0x0003, headerSize);
  stream.writeUInt16LE(0x0c15, headerSize + 2);
  stream.writeInt32LE(2, headerSize + 8);
  padding.copy(stream, headerSize + entrySize);
  return stream;
}

describe('PropertyStreamReader', () => {
  it('accepts zero padding after complete property entries', async () => {
    const stream = createRootPropertyStream(Buffer.alloc(4));
    const reader = new PropertyStreamReader({
      readStream: async () => stream,
    } as unknown as CFBFReader);

    await expect(reader.readNumber(['Root Entry'], ['0C15'])).resolves.toBe(2);
  });

  it('rejects a non-zero partial property entry', async () => {
    const stream = createRootPropertyStream(Buffer.from([0, 0, 1, 0]));
    const reader = new PropertyStreamReader({
      readStream: async () => stream,
    } as unknown as CFBFReader);

    await expect(reader.readNumber(['Root Entry'], ['0C15'])).rejects.toThrow(
      'Invalid property stream at Root Entry',
    );
  });

  it('treats a zero FILETIME as an absent date', async () => {
    const stream = Buffer.alloc(32 + 16);
    stream.writeUInt16LE(0x0040, 32);
    stream.writeUInt16LE(0x0039, 34);
    const reader = new PropertyStreamReader({
      readStream: async () => stream,
    } as unknown as CFBFReader);

    await expect(reader.read(['Root Entry'], ['0039'])).resolves.toBeUndefined();
  });
});
