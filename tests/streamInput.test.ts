import { Readable } from 'node:stream';
import * as fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseMsg } from '../src';
import { createRandomAccessSource } from '../src/cfb/InputSource';
import { CFBFConstants } from '../src/constants/cfbf';

const constants = new CFBFConstants();

function createEmptyMsg(): Buffer {
  const sectorSize = 512;
  const input = Buffer.alloc(sectorSize * 3);

  Buffer.from(constants.CFBF_SIGNATURE).copy(input);
  input.writeUInt16LE(0x003e, 0x18);
  input.writeUInt16LE(3, 0x1a);
  input.writeUInt16LE(0xfffe, 0x1c);
  input.writeUInt16LE(9, 0x1e);
  input.writeUInt16LE(6, 0x20);
  input.writeUInt32LE(1, 0x2c);
  input.writeUInt32LE(1, 0x30);
  input.writeUInt32LE(0x1000, 0x38);
  input.writeUInt32LE(constants.END_OF_CHAIN, 0x3c);
  input.writeUInt32LE(0, 0x40);
  input.writeUInt32LE(constants.END_OF_CHAIN, 0x44);
  input.writeUInt32LE(0, 0x48);
  input.fill(0xff, 0x4c, sectorSize);
  input.writeUInt32LE(0, 0x4c);

  const fatOffset = sectorSize;
  input.fill(0xff, fatOffset, fatOffset + sectorSize);
  input.writeUInt32LE(constants.FAT_SECTOR, fatOffset);
  input.writeUInt32LE(constants.END_OF_CHAIN, fatOffset + 4);

  const directoryOffset = sectorSize * 2;
  const rootName = Buffer.from('Root Entry\0', 'utf16le');
  rootName.copy(input, directoryOffset);
  input.writeUInt16LE(rootName.length, directoryOffset + 0x40);
  input.writeUInt8(5, directoryOffset + 0x42);
  input.writeUInt8(1, directoryOffset + 0x43);
  input.writeInt32LE(-1, directoryOffset + 0x44);
  input.writeInt32LE(-1, directoryOffset + 0x48);
  input.writeInt32LE(-1, directoryOffset + 0x4c);
  input.writeUInt32LE(constants.END_OF_CHAIN, directoryOffset + 0x74);

  return input;
}

function chunk(input: Buffer, size: number): Buffer[] {
  const result: Buffer[] = [];
  for (let offset = 0; offset < input.length; offset += size) {
    result.push(input.subarray(offset, offset + size));
  }
  return result;
}

describe('Readable input', () => {
  it('parses an MSG stream split into small chunks', async () => {
    const input = createEmptyMsg();
    const stream = Readable.from(chunk(Buffer.concat([input, Buffer.alloc(1024 * 1024)]), 7));

    const fromBuffer = await parseMsg(input);
    const fromStream = await parseMsg(stream);

    expect(fromStream).toEqual(fromBuffer);
    expect(stream.destroyed).toBe(true);
  });

  it('supports reads behind and ahead of the current stream position', async () => {
    const input = Buffer.from('0123456789abcdef');
    const source = createRandomAccessSource(
      Readable.from(chunk(input, 3)),
      {} as typeof fs,
    );

    expect((await source.read(8, 4)).toString()).toBe('89ab');
    expect((await source.read(1, 4)).toString()).toBe('1234');
    expect((await source.read(14, 8)).toString()).toBe('ef');
    await source.close();
  });

  it('propagates errors from the input stream', async () => {
    const input = createEmptyMsg();
    const failure = new Error('stream failed');
    const stream = Readable.from((async function* () {
      yield input.subarray(0, 700);
      throw failure;
    })());

    await expect(parseMsg(stream)).rejects.toBe(failure);
    expect(stream.destroyed).toBe(true);
  });

  it('spills buffered stream data to disk after the memory threshold', async () => {
    const input = Buffer.from('0123456789abcdef');
    const source = createRandomAccessSource(Readable.from(chunk(input, 3)), fs, {
      streamMemoryThreshold: 4,
    });

    expect((await source.read(10, 4)).toString()).toBe('abcd');
    expect((await source.read(1, 4)).toString()).toBe('1234');
    await source.close();
  });

  it('rejects Readable input beyond the configured size limit', async () => {
    const source = createRandomAccessSource(Readable.from([Buffer.alloc(9)]), fs, {
      maxInputBytes: 8,
    });

    await expect(source.read(0, 9)).rejects.toThrow('exceeds maxInputBytes (8)');
    await source.close();
  });

  it('checks trailing Readable bytes even when parsing needs only the beginning', async () => {
    const input = createEmptyMsg();
    const stream = Readable.from([input, Buffer.alloc(1)]);

    await expect(parseMsg(stream, { maxInputBytes: input.length }))
      .rejects.toThrow(`Readable MSG input exceeds maxInputBytes (${input.length})`);
    expect(stream.destroyed).toBe(true);
  });

  it('accepts a Readable exactly at the configured size limit', async () => {
    const input = createEmptyMsg();

    await expect(parseMsg(Readable.from([input]), { maxInputBytes: input.length }))
      .resolves.toEqual(await parseMsg(input));
  });
});

describe('Buffer input', () => {
  it('rejects input beyond the configured size limit before reading it', () => {
    expect(() => createRandomAccessSource(Buffer.alloc(9), fs, {
      maxInputBytes: 8,
    })).toThrow('Buffer MSG input exceeds maxInputBytes (8)');
  });
});

describe('File input', () => {
  it('rejects a file beyond the configured size limit before reading it', async () => {
    const stat = vi.fn(async () => ({ size: 9 }));
    const source = createRandomAccessSource(
      'message.msg',
      { promises: { stat } } as unknown as typeof fs,
      { maxInputBytes: 8 },
    );

    await expect(source.read(0, 1)).rejects.toThrow('File MSG input exceeds maxInputBytes (8)');
    expect(stat).toHaveBeenCalledWith('message.msg');
    await source.close();
  });

  it('keeps one file handle open for the source lifetime', async () => {
    const input = Buffer.from('0123456789abcdef');
    const close = vi.fn(async () => undefined);
    const read = vi.fn(async (
      target: Buffer,
      targetOffset: number,
      length: number,
      position: number,
    ) => {
      const bytesRead = input.copy(target, targetOffset, position, position + length);
      return { bytesRead, buffer: target };
    });
    const open = vi.fn(async () => ({ read, close }));
    const source = createRandomAccessSource(
      'message.msg',
      { promises: { open } } as unknown as typeof fs,
    );

    expect((await source.read(0, 4)).toString()).toBe('0123');
    expect((await source.read(8, 4)).toString()).toBe('89ab');
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();

    await source.close();
    await source.close();
    expect(close).toHaveBeenCalledTimes(1);
    await expect(source.read(0, 1)).rejects.toThrow('closed MSG input');
  });
});
