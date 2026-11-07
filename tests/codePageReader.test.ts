import { describe, expect, it, vi } from 'vitest';
import { UnsupportedMsgFeatureError } from '../src/errors/errors';
import { CodePageReader } from '../src/mapi/CodePageReader';
import type { PropertyStreamReader } from '../src/mapi/PropertyStreamReader';

describe('CodePageReader', () => {
  it.each([false, true])('keeps HTML and message code pages separate (HTML first: %s)', async (htmlFirst) => {
    const values: Record<string, number> = { '3FFD': 1252, '3FDE': 65001 };
    const readNumber = vi.fn(async (_root: string[], ids: string[]) =>
      ids.map(id => values[id]).find(value => value !== undefined));
    const reader = new CodePageReader({ readNumber } as unknown as PropertyStreamReader);

    for (const preferInternet of [htmlFirst, !htmlFirst, htmlFirst, !htmlFirst]) {
      await expect(reader.getCodepage(preferInternet)).resolves.toBe(preferInternet ? 65001 : 1252);
    }
    expect(readNumber).toHaveBeenCalledTimes(2);
  });

  it('falls back to the message code page for HTML without PR_INTERNET_CPID', async () => {
    const values: Record<string, number> = { '3FFD': 1250 };
    const propertyStream = {
      readNumber: async (_root: string[], ids: string[]) =>
        ids.map(id => values[id]).find(value => value !== undefined),
    } as unknown as PropertyStreamReader;

    await expect(new CodePageReader(propertyStream).getCodepage(true)).resolves.toBe(1250);
  });

  it('rejects an explicitly unsupported code page', async () => {
    const propertyStream = {
      readNumber: vi.fn(async () => 932),
    } as unknown as PropertyStreamReader;

    await expect(new CodePageReader(propertyStream).getCodepage()).rejects.toMatchObject({
      name: UnsupportedMsgFeatureError.name,
      message: 'Unsupported MSG code page: 932',
    });
  });

  it('keeps the default when no code page is specified', async () => {
    const propertyStream = {
      readNumber: vi.fn(async () => undefined),
    } as unknown as PropertyStreamReader;

    await expect(new CodePageReader(propertyStream).getCodepage()).resolves.toBe(1252);
  });

  it('returns a supported code page', async () => {
    const propertyStream = {
      readNumber: vi.fn(async () => 1251),
    } as unknown as PropertyStreamReader;

    await expect(new CodePageReader(propertyStream).getCodepage()).resolves.toBe(1251);
  });

  it('accepts US-ASCII code page 20127', async () => {
    const propertyStream = {
      readNumber: vi.fn(async () => 20127),
    } as unknown as PropertyStreamReader;

    await expect(new CodePageReader(propertyStream).getCodepage()).resolves.toBe(20127);
  });
});
