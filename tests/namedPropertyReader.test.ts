import { describe, expect, it, vi } from 'vitest';
import type { CFBFReader } from '../src/cfb/CFBReader';
import { PROPERTY_SET_GUIDS } from '../src/constants/properties';
import { DirectoryEntryType, type DirectoryNode } from '../src/types';
import { NoopLogger } from '../src/logging/Logger';
import { NamedPropertyReader } from '../src/mapi/NamedPropertyReader';
import { PropertyStore } from '../src/mapi/PropertyStore';
import type { PropertyReader } from '../src/mapi/PropertyReader';

const CUSTOM_GUID = '{00062002-0000-0000-C000-000000000046}';

function createMappingStreams(): Map<string, Buffer> {
  const guidStream = Buffer.from('0220060000000000c000000000000046', 'hex');
  const name = Buffer.from('CustomName', 'utf16le');
  const stringStream = Buffer.alloc(12 + name.length);
  stringStream.writeUInt32LE(2, 0);
  Buffer.from('A', 'utf16le').copy(stringStream, 4);
  stringStream.writeUInt32LE(name.length, 8);
  name.copy(stringStream, 12);

  const entryStream = Buffer.alloc(16);
  entryStream.writeUInt32LE(0x1234, 0);
  entryStream.writeUInt32LE(3 << 16, 4);
  entryStream.writeUInt32LE(8, 8);
  entryStream.writeUInt32LE(0x80000000 + (2 << 16) + 1, 12);

  return new Map([
    ['__substg1.0_00020102', guidStream],
    ['__substg1.0_00030102', entryStream],
    ['__substg1.0_00040102', stringStream],
  ]);
}

function node(name: string, type: DirectoryEntryType, children: DirectoryNode[] = []): DirectoryNode {
  return {
    sid: 0,
    name,
    type,
    startingSectorLocation: 0,
    streamSize: 0,
    children,
    parentSid: null,
  };
}

describe('NamedPropertyReader', () => {
  it('reads GUID, entry, and string streams according to MS-OXMSG', async () => {
    const streams = createMappingStreams();
    const readStream = vi.fn(async (path: string[]) => streams.get(path[path.length - 1]) ?? null);
    const cfbReader = { readStream } as unknown as CFBFReader;
    const reader = new NamedPropertyReader(cfbReader, new NoopLogger());

    await reader.initialize();

    expect(reader.getPropertyId(CUSTOM_GUID.toLowerCase(), 0x1234)).toBe(0x8000);
    expect(reader.getPropertyId(PROPERTY_SET_GUIDS.PS_PUBLIC_STRINGS, 'CustomName')).toBe(0x8001);
    expect(readStream).toHaveBeenCalledWith([
      'Root Entry',
      '__nameid_version1.0',
      '__substg1.0_00020102',
    ]);
    expect(readStream).toHaveBeenCalledWith([
      'Root Entry',
      '__nameid_version1.0',
      '__substg1.0_00030102',
    ]);
    expect(readStream).toHaveBeenCalledWith([
      'Root Entry',
      '__nameid_version1.0',
      '__substg1.0_00040102',
    ]);
  });

  it('makes string named properties available through PropertyStore.readNamed', async () => {
    const streams = createMappingStreams();
    const tree = node('Root Entry', DirectoryEntryType.Root, [
      node('__substg1.0_8001001F', DirectoryEntryType.Stream),
    ]);
    const cfbReader = {
      getTree: () => tree,
      readStream: vi.fn(async (path: string[]) => streams.get(path[path.length - 1]) ?? null),
    } as unknown as CFBFReader;
    const propertyReader = {
      readUnicodeString: vi.fn(async () => 'named value'),
    } as unknown as PropertyReader;
    const namedProperties = new NamedPropertyReader(cfbReader, new NoopLogger());
    const store = new PropertyStore(cfbReader, propertyReader, namedProperties);

    await expect(store.readNamed(PROPERTY_SET_GUIDS.PS_PUBLIC_STRINGS, 'CustomName'))
      .resolves.toBe('named value');
    expect(propertyReader.readUnicodeString).toHaveBeenCalledWith([
      'Root Entry',
      '__substg1.0_8001001F',
    ]);
  });
});
