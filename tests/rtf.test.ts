import { describe, expect, it } from 'vitest';
import { PropertyDecodeError } from '../src/errors/errors';
import { decompressRtf } from '../src/rtf/decompressRtf';

describe('RTF decompression', () => {
  it('reads an uncompressed MELA payload', () => {
    const body = Buffer.from('{\\rtf1 test}', 'ascii');
    const input = Buffer.alloc(16 + body.length);
    input.writeUInt32LE(input.length - 4, 0);
    input.writeUInt32LE(body.length, 4);
    input.writeUInt32LE(0x414c454d, 8);
    body.copy(input, 16);

    expect(decompressRtf(input)).toBe('{\\rtf1 test}');
  });

  it('rejects a truncated payload', () => {
    expect(() => decompressRtf(Buffer.alloc(8))).toThrow(PropertyDecodeError);
  });
});
