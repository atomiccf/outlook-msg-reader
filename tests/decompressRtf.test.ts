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

  it.each([UNCOMPRESSED_MAGIC, COMPRESSED_MAGIC])('decodes literal RTF text using ansicpg1251 (%s)', (magic) => {
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

    expect(decompressRtf(input)).toBe('{\\rtf1\\ansi\\ansicpg1251 Привет}');
  });
});
