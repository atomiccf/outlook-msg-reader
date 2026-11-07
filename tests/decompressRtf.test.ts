import { describe, expect, it } from 'vitest';
import { decompressRtf } from '../src/rtf/decompressRtf';

const COMPRESSED_MAGIC = 0x75465a4c;
const UNCOMPRESSED_MAGIC = 0x414c454d;

function createHeader(rawSize: number): Buffer {
  const input = Buffer.alloc(16);
  input.writeUInt32LE(12, 0);
  input.writeUInt32LE(rawSize, 4);
  input.writeUInt32LE(COMPRESSED_MAGIC, 8);
  return input;
}

describe('decompressRtf', () => {
  it('counts UTF-8 payload bytes of the lossless byte string as well as the raw allocation', () => {
    const input = Buffer.alloc(17);
    input.writeUInt32LE(13, 0);
    input.writeUInt32LE(1, 4);
    input.writeUInt32LE(UNCOMPRESSED_MAGIC, 8);
    input[16] = 0xe9;
    expect(() => decompressRtf(input, undefined, 1)).toThrow('RTF text exceeds remaining maxResultBytes (1)');
    expect(decompressRtf(input, undefined, 2)).toBe('é');
  });

  it('rejects a declared output size beyond the configured limit', () => {
    expect(() => decompressRtf(createHeader(9), 8))
      .toThrow('RTF body exceeds maxRtfBytes (8)');
  });

  it('validates the configured output limit', () => {
    expect(() => decompressRtf(createHeader(0), -1))
      .toThrow('maxRtfBytes must be a non-negative safe integer');
  });

  it('preserves high-bit bytes in an uncompressed RTF body', () => {
    const input = Buffer.alloc(17);
    input.writeUInt32LE(input.length - 4, 0);
    input.writeUInt32LE(1, 4);
    input.writeUInt32LE(UNCOMPRESSED_MAGIC, 8);
    input[16] = 0xe9;

    expect(decompressRtf(input)).toBe('\u00e9');
  });

  it('preserves high-bit bytes in a compressed RTF body', () => {
    const input = Buffer.alloc(18);
    input.writeUInt32LE(input.length - 4, 0);
    input.writeUInt32LE(1, 4);
    input.writeUInt32LE(COMPRESSED_MAGIC, 8);
    input[16] = 0; // literal byte
    input[17] = 0xe9;

    expect(decompressRtf(input)).toBe('\u00e9');
  });

  it.each([UNCOMPRESSED_MAGIC, COMPRESSED_MAGIC])('preserves literal RTF bytes independently of ansicpg1251 (%s)', (magic) => {
    const body = Buffer.concat([
      Buffer.from('{\\rtf1\\ansi\\ansicpg1251 ', 'ascii'),
      Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]),
      Buffer.from('}', 'ascii'),
    ]);
    const payload = magic === UNCOMPRESSED_MAGIC
      ? body
      : Buffer.concat(Array.from({ length: Math.ceil(body.length / 8) }, (_, index) =>
        Buffer.concat([Buffer.from([0]), body.subarray(index * 8, index * 8 + 8)])));
    const input = Buffer.alloc(16 + payload.length);
    input.writeUInt32LE(input.length - 4, 0);
    input.writeUInt32LE(body.length, 4);
    input.writeUInt32LE(magic, 8);
    payload.copy(input, 16);

    expect(Buffer.from(decompressRtf(input), 'latin1')).toEqual(body);
  });

  it.each([UNCOMPRESSED_MAGIC, COMPRESSED_MAGIC])('preserves arbitrary binary bytes in a UTF-8 document (%s)', (magic) => {
    const body = Buffer.concat([
      Buffer.from(String.raw`{\rtf1\ansicpg65001{\pict\bin5 `),
      Buffer.from([0xe4, 0xb8, 0xad, 0xff, 0x00]), Buffer.from('}}'),
    ]);
    const payload = magic === UNCOMPRESSED_MAGIC ? body : Buffer.concat(
      Array.from({ length: Math.ceil(body.length / 8) }, (_, index) =>
        Buffer.concat([Buffer.from([0]), body.subarray(index * 8, index * 8 + 8)])));
    const input = Buffer.alloc(16 + payload.length);
    input.writeUInt32LE(input.length - 4, 0);
    input.writeUInt32LE(body.length, 4);
    input.writeUInt32LE(magic, 8);
    payload.copy(input, 16);
    expect(Buffer.from(decompressRtf(input), 'latin1')).toEqual(body);
  });
});
