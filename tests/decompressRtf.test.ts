import { describe, expect, it } from 'vitest';
import { decompressRtf } from '../src/rtf/decompressRtf';

const COMPRESSED_MAGIC = 0x75465a4c;

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
});
