import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/logging/Logger';
import type { PropertyStore } from '../src/mapi/PropertyStore';
import type { PropertyStreamReader } from '../src/mapi/PropertyStreamReader';
import { RecipientReader } from '../src/msg/RecipientReader';
import { SenderReader } from '../src/msg/SenderReader';

describe('address readers', () => {
  it('prefers the recipient SMTP address over an Exchange Legacy DN', async () => {
    const storagePath = ['Root Entry', '__recip_version1.0_#00000000'];
    const properties = {
      findStorages: () => [storagePath],
      readStringAt: vi.fn(async (_path: string[], ids: string[]) => {
        if (ids[0] === '3001') return 'Wilson, Chris';
        if (ids[0] === '39FE') return 'chris.wilson@example.test';
        return undefined;
      }),
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
