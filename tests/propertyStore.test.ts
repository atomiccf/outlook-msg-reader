import { describe, expect, it, vi } from 'vitest';
import type { CFBFReader } from '../src/cfb/CFBReader';
import { PropertyStore } from '../src/mapi/PropertyStore';
import type { NamedPropertyReader } from '../src/msg/NamedPropertyReader';
import type { PropertyReader } from '../src/msg/PropertyReader';
import { DirectoryEntryType, type DirectoryNode } from '../src/types';

function node(
  name: string,
  type: DirectoryEntryType,
  children: DirectoryNode[] = [],
): DirectoryNode {
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

function createTree(): DirectoryNode {
  return node('Root Entry', DirectoryEntryType.Root, [
    node('__attach_version1.0_#00000000', DirectoryEntryType.Storage, [
      node('__substg1.0_0037001F', DirectoryEntryType.Stream),
      node('__substg1.0_3701000D', DirectoryEntryType.Storage, [
        node('__attach_version1.0_#00000001', DirectoryEntryType.Storage),
      ]),
    ]),
  ]);
}

describe('PropertyStore storage scoping', () => {
  it('does not use nested properties as root message properties', async () => {
    const readUnicodeString = vi.fn(async () => 'nested subject');
    const store = new PropertyStore(
      { getTree: () => createTree() } as unknown as CFBFReader,
      { readUnicodeString } as unknown as PropertyReader,
      {} as NamedPropertyReader,
    );

    await expect(store.readString(['0037'])).resolves.toBeUndefined();
    expect(readUnicodeString).not.toHaveBeenCalled();
  });

  it('returns only direct child storages for the requested parent', () => {
    const store = new PropertyStore(
      { getTree: () => createTree() } as unknown as CFBFReader,
      {} as PropertyReader,
      {} as NamedPropertyReader,
    );

    expect(store.findStorages('__attach_version1.0_')).toEqual([
      ['Root Entry', '__attach_version1.0_#00000000'],
    ]);
    expect(store.findStorages('__attach_version1.0_', [
      'Root Entry',
      '__attach_version1.0_#00000000',
      '__substg1.0_3701000D',
    ])).toEqual([
      [
        'Root Entry',
        '__attach_version1.0_#00000000',
        '__substg1.0_3701000D',
        '__attach_version1.0_#00000001',
      ],
    ]);
  });
});
