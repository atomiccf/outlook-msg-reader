import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/logging/Logger';
import type { PropertyStore } from '../src/mapi/PropertyStore';
import type { PropertyStreamReader } from '../src/mapi/PropertyStreamReader';
import { PropertyDecodeError } from '../src/errors/errors';
import { RecipientReader } from '../src/msg/RecipientReader';
import { SenderReader } from '../src/msg/SenderReader';

describe('address readers', () => {
  function displayReader(values: Record<string, string> = {}) {
    const properties = {
      findStorages: () => [],
      readString: vi.fn(async (ids: string[]) => values[ids[0]]),
    } as unknown as PropertyStore;
    return new RecipientReader(properties, {} as PropertyStreamReader, { warn: vi.fn() } as unknown as Logger);
  }

  it('parses display delimiters without backtracking on repeated opening brackets', async () => {
    const value = '<'.repeat(32_000);
    const start = performance.now();
    await expect(displayReader({ '0E04': value }).read()).resolves.toEqual({ to: [{ name: value, email: '' }] });
    expect(performance.now() - start).toBeLessThan(1000);
    await expect(displayReader({ '0E04': 'Name <a<b>; <<x>; bare@example.test; Display' }).read())
      .resolves.toEqual({ to: [
        { name: 'Name', email: 'a<b' }, { name: '<', email: 'x' },
        { name: '', email: 'bare@example.test' }, { name: 'Display', email: '' },
      ] });
  });

  it('counts display recipients across To, Cc and Bcc', async () => {
    const reader = displayReader({ '0E04': 'A; B', '0E03': 'C', '0E02': 'D' });
    await expect(reader.read(3)).rejects.toThrow('maxRecipients (3)');
    await expect(reader.read(4)).resolves.toMatchObject({ bcc: [{ name: 'D', email: '' }] });
    await expect(displayReader({ '0E04': 'A' }).read(0)).rejects.toThrow('maxRecipients (0)');
  });

  it('preserves folded whitespace before an address delimiter', async () => {
    await expect(displayReader({ '0E04': 'Name\r\n <address>; a<\n<b>; a\nb<c>' }).read())
      .resolves.toEqual({ to: [
        { name: 'Name', email: 'address' }, { name: 'a<', email: 'b' }, { name: 'a\nb<c>', email: '' },
      ] });
  });

  it('rejects too many recipient storages before reading their properties', async () => {
    const readNumber = vi.fn();
    const properties = { findStorages: () => [['a'], ['b']] } as unknown as PropertyStore;
    const reader = new RecipientReader(properties, { readNumber } as unknown as PropertyStreamReader,
      { warn: vi.fn() } as unknown as Logger);
    await expect(reader.read(1)).rejects.toThrow('maxRecipients (1)');
    expect(readNumber).not.toHaveBeenCalled();
  });

  it('checks UTF-8 budget before reading the next recipient property', async () => {
    const readStringAt = vi.fn(async () => 'Я');
    const properties = { findStorages: () => [['a'], ['b']], readStringAt } as unknown as PropertyStore;
    const reader = new RecipientReader(properties,
      { readNumber: async () => 1 } as unknown as PropertyStreamReader, { warn: vi.fn() } as unknown as Logger);
    await expect(reader.read(2, 4, 3)).rejects.toThrow('maxResultBytes (4)');
    expect(readStringAt).toHaveBeenCalledTimes(1);
    await expect(displayReader({ '0E04': 'Я; Ю' }).read(2, 4)).resolves.toMatchObject({ to: [{ name: 'Я' }, { name: 'Ю' }] });
    await expect(displayReader({ '0E04': 'Я; Ю' }).read(2, 3)).rejects.toThrow('maxResultBytes (3)');
  });

  it('prefers the recipient SMTP address over an Exchange Legacy DN', async () => {
    const storagePath = ['Root Entry', '__recip_version1.0_#00000000'];
    const properties = {
      findStorages: () => [storagePath],
      readStringAt: vi.fn(async (_path: string[], ids: string[]) => {
        if (ids[0] === '3001') return 'Wilson, Chris';
        if (ids[0] === '39FE') return 'chris.wilson@example.test';
        return undefined;
      }),
      readString: vi.fn(async () => undefined),
    } as unknown as PropertyStore;
    const propertyStream = {
      readNumber: vi.fn(async () => 1),
    } as unknown as PropertyStreamReader;

    const result = await new RecipientReader(
      properties,
      propertyStream,
      { warn: vi.fn() } as unknown as Logger,
    ).read();

    expect(result.to).toEqual([{
      name: 'Wilson, Chris',
      email: 'chris.wilson@example.test',
    }]);
    expect(properties.readStringAt).toHaveBeenCalledWith(storagePath, ['3001', '39FF']);
    expect(properties.readStringAt).toHaveBeenCalledWith(storagePath, ['39FE', '3003', '0C1F']);
  });

  it('restores missing Cc and Bcc recipients when To entries exist', async () => {
    const storagePath = ['Root Entry', '__recip_version1.0_#00000000'];
    const readString = vi.fn(async (ids: string[]) => {
      if (ids[0] === '0E03') return 'Copy <copy@example.test>';
      if (ids[0] === '0E02') return 'hidden@example.test';
      return undefined;
    });
    const properties = {
      findStorages: () => [storagePath],
      readStringAt: vi.fn(async (_path: string[], ids: string[]) => {
        if (ids[0] === '3001') return 'Primary';
        if (ids[0] === '39FE') return 'primary@example.test';
        return undefined;
      }),
      readString,
    } as unknown as PropertyStore;
    const propertyStream = {
      readNumber: vi.fn(async () => 1),
    } as unknown as PropertyStreamReader;

    const result = await new RecipientReader(
      properties,
      propertyStream,
      { warn: vi.fn() } as unknown as Logger,
    ).read();

    expect(result).toEqual({
      to: [{ name: 'Primary', email: 'primary@example.test' }],
      cc: [{ name: 'Copy', email: 'copy@example.test' }],
      bcc: [{ name: '', email: 'hidden@example.test' }],
    });
    expect(readString).not.toHaveBeenCalledWith(['0E04']);
    expect(readString).toHaveBeenCalledWith(['0E03']);
    expect(readString).toHaveBeenCalledWith(['0E02']);
  });

  it('reports a failed recipient instead of returning a partial list', async () => {
    const first = ['Root Entry', '__recip_version1.0_#00000000'];
    const second = ['Root Entry', '__recip_version1.0_#00000001'];
    const failure = new Error('damaged property');
    const properties = {
      findStorages: () => [first, second],
      readStringAt: vi.fn(async (path: string[], ids: string[]) => {
        if (path === second) throw failure;
        return ids[0] === '3001' ? 'Primary' : 'primary@example.test';
      }),
      readString: vi.fn(async () => undefined),
    } as unknown as PropertyStore;
    const propertyStream = {
      readNumber: vi.fn(async () => 1),
    } as unknown as PropertyStreamReader;

    const read = new RecipientReader(properties, propertyStream, { warn: vi.fn() } as unknown as Logger).read();

    await expect(read).rejects.toMatchObject({
      name: PropertyDecodeError.name,
      message: `Unable to read recipient at ${second.join(' / ')}`,
      cause: failure,
    });
  });

  it('prefers the sender SMTP property over an Exchange Legacy DN', async () => {
    const properties = {
      readString: vi.fn(async (ids: string[]) => {
        if (ids[0] === '0C1A') return 'Wilson, Chris';
        if (ids[0] === '5D01') return 'chris.wilson@example.test';
        return undefined;
      }),
    } as unknown as PropertyStore;

    const result = await new SenderReader(properties).read();

    expect(result).toEqual({
      name: 'Wilson, Chris',
      email: 'chris.wilson@example.test',
    });
    expect(properties.readString).toHaveBeenCalledWith(['5D01', '5D02', '0C1F', '0065']);
  });
});
