import { describe, expect, it, vi } from 'vitest';
import { Decoder } from '../src/encoding/decoder';
import type { PropertyStore } from '../src/mapi/PropertyStore';
import { SubjectReader } from '../src/msg/SubjectReader';

describe('MSG code page decoding', () => {
  it('decodes code page 20127 as US-ASCII', () => {
    expect(new Decoder().decodeBytes(Buffer.from([0x48, 0x69, 0x00, 0x7f, 0x80]), 20127))
      .toBe('Hi\0\x7f\uFFFD');
  });

  it('decodes Outlook ANSI code pages for Polish and Russian', () => {
    const decoder = new Decoder();
    expect(decoder.decodeBytes(Buffer.from([0x5a, 0x61, 0xbf, 0xf3, 0xb3, 0xe6]), 28592))
      .toBe('Zażółć');
    expect(decoder.decodeBytes(Buffer.from([0xf0, 0xd2, 0xc9, 0xd7, 0xc5, 0xd4]), 20866))
      .toBe('Привет');
  });
});

describe('RFC 2047 decoding', () => {
  it.each([
    ['=?windows-1251?B?z/Do4uXy?=', 'Привет'],
    ['=?ISO-8859-2?B?WmG/87Pm?=', 'Zażółć'],
    ['=?windows-1251?Q?=CF=F0=E8=E2=E5=F2?=', 'Привет'],
  ])('decodes the declared charset in %s', (header, expected) => {
    expect(new Decoder().decodeRFC2047(header)).toBe(expected);
  });

  it('decodes a subject from MIME headers using its declared charset', async () => {
    const properties = {
      readString: vi.fn(async (ids: string[]) => ids[0] === '007D'
        ? 'From: sender@example.com\r\nSubject: =?windows-1251?B?z/Do4uXy?=\r\n'
        : undefined),
    } as unknown as PropertyStore;

    await expect(new SubjectReader(properties, new Decoder()).read()).resolves.toBe('Привет');
  });
});
