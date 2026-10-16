import { describe, expect, it, vi } from 'vitest';
import { UnsupportedMsgFeatureError } from '../src/errors/errors';
import { CodePageReader } from '../src/mapi/CodePageReader';
import type { PropertyStreamReader } from '../src/mapi/PropertyStreamReader';

describe('CodePageReader', () => {
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
});
