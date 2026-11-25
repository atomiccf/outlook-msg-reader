import { describe, expect, it } from 'vitest';
import { PropertyDecodeError, parseMsg } from '../../src';
import { decompressRtf } from '../../src/rtf/decompressRtf';
import { extractRtfBody } from '../../src/rtf/extractRtfBody';
import { expectControlledFailure, withDeadline } from './helpers/expectations';
import { loadFixture } from './helpers/fixtures';

const LZFU = 0x75465a4c;
const MELA = 0x414c454d;
const INITIAL_DICTIONARY = Buffer.from(
  '{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx',
  'ascii',
);

function header(magic: number, rawSize: number, payload: Buffer, compressedSize?: number): Buffer {
  const input = Buffer.alloc(16 + payload.length);
  input.writeUInt32LE(compressedSize ?? input.length - 4, 0);
  input.writeUInt32LE(rawSize, 4);
  input.writeUInt32LE(magic, 8);
  payload.copy(input, 16);
  return input;
}

function lzfuStopToken(): Buffer {
  const payload = Buffer.alloc(3);
  payload[0] = 0x01;
  const offset = INITIAL_DICTIONARY.length;
  payload[1] = offset >> 4;
  payload[2] = ((offset & 0x0f) << 4) | 0;
  return header(LZFU, 64, payload);
}

function lzfuExact(rawSize: number): Buffer {
  const controlCount = Math.ceil(rawSize / 8);
  const payload = Buffer.alloc(controlCount + rawSize);
  let o = 0;
  let remaining = rawSize;
  for (let c = 0; c < controlCount; c += 1) {
    payload[o] = 0;
    o += 1;
    const n = Math.min(8, remaining);
    payload.fill(0x61, o, o + n);
    o += n;
    remaining -= n;
  }
  return header(LZFU, rawSize, payload.subarray(0, o));
}

describe('RTF bombs', () => {
  it('rejects UINT32_MAX rawSize under the default maxRtfBytes', async () => {
    const input = header(LZFU, 0xffffffff, Buffer.alloc(1));
    const error = await expectControlledFailure(() => decompressRtf(input), [RangeError], 500);
    expect(error).toBeInstanceOf(RangeError);
  });

  it('rejects compressedSize that overruns the buffer', async () => {
    const input = header(LZFU, 1, Buffer.alloc(1), 0xfffffff0);
    const error = await expectControlledFailure(
      () => decompressRtf(input),
      [PropertyDecodeError],
      500,
    );
    expect(error).toBeInstanceOf(PropertyDecodeError);
  });

  it('rejects MELA when rawSize exceeds the remaining bytes', async () => {
    const input = header(MELA, 32, Buffer.from('short'));
    const error = await expectControlledFailure(
      () => decompressRtf(input),
      [PropertyDecodeError],
      500,
    );
    expect(error).toBeInstanceOf(PropertyDecodeError);
  });

  it('stops LZFu when a back-reference matches the dictionary offset', async () => {
    const result = await withDeadline(500, () => decompressRtf(lzfuStopToken()));
    expect(typeof result).toBe('string');
    expect(result.length).toBeLessThan(64);
  });

  it('decompresses an LZFu payload that fills exactly rawSize', async () => {
    const result = await withDeadline(500, () => decompressRtf(lzfuExact(40)));
    expect(result).toHaveLength(40);
    expect(result).toBe('a'.repeat(40));
  });

  it('rejects a 64 MiB rawSize against a 1 KiB cap immediately', async () => {
    const input = header(LZFU, 64 * 1024 * 1024, Buffer.alloc(1024));
    const error = await expectControlledFailure(() => decompressRtf(input, 1024), [RangeError], 500);
    expect(error).toBeInstanceOf(RangeError);
  });

  it('rejects an uncompressed \\bin run that would skip gigabytes', async () => {
    const error = await expectControlledFailure(
      () => extractRtfBody('{\\rtf1\\bin999999999 x}'),
      [PropertyDecodeError],
      500,
    );
    expect(error).toBeInstanceOf(PropertyDecodeError);
  });

  it('parses a real RTF fixture under a deadline', async () => {
    const message = await withDeadline(2000, () => parseMsg(loadFixture('rtf-unicode')));
    expect(message.body.rtf || message.body.text || message.body.html).toBeTruthy();
  });
});
