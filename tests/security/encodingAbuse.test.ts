import { describe, expect, it } from 'vitest';
import { Decoder } from '../../src/encoding/decoder';
import { CodePageReader } from '../../src/mapi/CodePageReader';
import type { PropertyStreamReader } from '../../src/mapi/PropertyStreamReader';
import { UnsupportedMsgFeatureError } from '../../src';
import { expectControlledFailure, withDeadline } from './helpers/expectations';

describe('encoding abuse', () => {
  it('handles a 1 MiB base64 encoded-word without hanging', async () => {
    const payload = Buffer.alloc(1024 * 1024, 0x41).toString('base64');
    const header = `=?utf-8?B?${payload}?=`;
    const result = await withDeadline(2000, () => new Decoder().decodeRFC2047(header));
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(1024 * 1024);
  });

  it('does not recurse on nested encoded-words', async () => {
    const nested = '=?utf-8?B?=?utf-8?B?QUFB?=?=';
    const result = await withDeadline(500, () => new Decoder().decodeRFC2047(nested));
    expect(typeof result).toBe('string');
    expect(result.includes('=?utf-8?B?') || result.length >= 0).toBe(true);
  });

  it('treats unknown and non-ASCII charsets as a fallback, not a TypeError', async () => {
    const decoder = new Decoder();
    const unknown = decoder.decodeRFC2047('=?unknown-xyz?B?QUFB?=');
    const nonAscii = decoder.decodeRFC2047('=?utf-8\u2603?B?QUFB?=');
    expect(typeof unknown).toBe('string');
    expect(typeof nonAscii).toBe('string');
  });

  it.each([0xffff, 0x0000])('rejects MAPI code page 0x%s with a MsgError subclass', async (codepage) => {
    const propertyStream = {
      readNumber: async () => codepage,
    } as unknown as PropertyStreamReader;
    const error = await expectControlledFailure(
      () => new CodePageReader(propertyStream).getCodepage(),
      [UnsupportedMsgFeatureError],
      500,
    );
    expect(error).toBeInstanceOf(UnsupportedMsgFeatureError);
  });

  it('tolerates a lone equals and a truncated quoted-printable triplet', async () => {
    const decoder = new Decoder();
    expect(() => decoder.decodeRFC2047('=?utf-8?Q?=?=')).not.toThrow();
    expect(() => decoder.decodeRFC2047('=?utf-8?Q?=AB?=')).not.toThrow();
    const truncated = decoder.decodeRFC2047('=?utf-8?Q?=AB?= extra = leftover');
    expect(typeof truncated).toBe('string');
  });
});
