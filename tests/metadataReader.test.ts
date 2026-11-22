import { describe, expect, it, vi } from 'vitest';
import type { PropertyStore } from '../src/mapi/PropertyStore';
import type { PropertyStreamReader } from '../src/mapi/PropertyStreamReader';
import { MetadataReader } from '../src/msg/MetadataReader';

describe('MetadataReader', () => {
  it('reads standard message metadata from the root storage', async () => {
    const sentAt = new Date('2026-01-02T03:04:05.000Z');
    const receivedAt = new Date('2026-01-02T03:05:06.000Z');
    const createdAt = new Date('2026-01-02T03:00:00.000Z');
    const modifiedAt = new Date('2026-01-02T03:10:00.000Z');
    const readStringAt = vi.fn(async (_path: string[], ids: string[]) => {
      if (ids[0] === '1035') return ' <message@example.test> ';
      if (ids[0] === '007D') return ' From: sender@example.test\r\n ';
      return undefined;
    });
    const dates = new Map([
      ['0039', sentAt],
      ['0E06', receivedAt],
      ['3007', createdAt],
      ['3008', modifiedAt],
    ]);
    const read = vi.fn(async (_path: string[], ids: string[]) => dates.get(ids[0]));
    const readNumber = vi.fn(async () => 2);
    const reader = new MetadataReader(
      { readStringAt } as unknown as PropertyStore,
      { read, readNumber } as unknown as PropertyStreamReader,
    );

    await expect(reader.read()).resolves.toEqual({
      messageId: '<message@example.test>',
      sentAt,
      receivedAt,
      createdAt,
      modifiedAt,
      transportHeaders: 'From: sender@example.test',
      importance: 'high',
    });
    expect(readStringAt).toHaveBeenCalledWith(['Root Entry'], ['1035']);
    expect(readStringAt).toHaveBeenCalledWith(['Root Entry'], ['007D']);
  });

  it('omits missing, invalid, and unknown metadata values', async () => {
    const reader = new MetadataReader(
      { readStringAt: vi.fn(async () => undefined) } as unknown as PropertyStore,
      {
        read: vi.fn(async () => new Date(Number.NaN)),
        readNumber: vi.fn(async () => 99),
      } as unknown as PropertyStreamReader,
    );

    await expect(reader.read()).resolves.toEqual({
      messageId: undefined,
      sentAt: undefined,
      receivedAt: undefined,
      createdAt: undefined,
      modifiedAt: undefined,
      transportHeaders: undefined,
      importance: undefined,
    });
  });
});
