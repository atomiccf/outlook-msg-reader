import { Readable } from 'node:stream';
import type * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
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
});
