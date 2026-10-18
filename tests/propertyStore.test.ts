import { describe, expect, it, vi } from 'vitest';
import type { CFBFReader } from '../src/cfb/CFBReader';
import { PropertyStore } from '../src/mapi/PropertyStore';
import type { NamedPropertyReader } from '../src/mapi/NamedPropertyReader';
import { PropertyReader } from '../src/mapi/PropertyReader';
import type { CodePageReader } from '../src/mapi/CodePageReader';
import { Decoder } from '../src/encoding/decoder';
import { DirectoryEntryType, type DirectoryNode } from '../src/types';
import { SenderReader } from '../src/msg/SenderReader';

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
  it('isolates repeated property IDs in a large recipient tree', async () => {
    const children = Array.from({ length: 2000 }, (_, index) => node(
      `__recip_version1.0_#${index}`, DirectoryEntryType.Storage,
      [node('__substg1.0_3001001F', DirectoryEntryType.Stream)],
    ));
    const tree = node('Root Entry', DirectoryEntryType.Root, children);
    const readUnicodeString = vi.fn(async (path: string[]) => path[1]);
    const store = new PropertyStore({ getTree: () => tree } as unknown as CFBFReader,
      { readUnicodeString } as unknown as PropertyReader, {} as NamedPropertyReader);
    for (const child of children) {
      await expect(store.readStringAt(['Root Entry', child.name], ['3001'])).resolves.toBe(child.name);
    }
    expect(readUnicodeString).toHaveBeenCalledTimes(children.length);
    await expect(store.readStringAt([children[0].name], ['3001'])).resolves.toBe(children[0].name);
  });

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

  it('initializes named properties only when they are requested', async () => {
    const initialize = vi.fn(async () => undefined);
    const getPropertyId = vi.fn(() => undefined);
    const store = new PropertyStore(
      { getTree: () => createTree() } as unknown as CFBFReader,
      {} as PropertyReader,
      { initialize, getPropertyId } as unknown as NamedPropertyReader,
    );

    await store.readString(['0037']);
    expect(initialize).not.toHaveBeenCalled();

    await store.readNamed('{guid}', 'property');
    await store.readNamed('{guid}', 'property');

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(getPropertyId).toHaveBeenCalledTimes(2);
  });

  it('decodes ANSI properties with the message code page', async () => {
    const tree = node('Root Entry', DirectoryEntryType.Root, [
      node('__substg1.0_0037001E', DirectoryEntryType.Stream),
    ]);
    const cfbReader = {
      getTree: () => tree,
      readStream: vi.fn(async () => Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x00])),
    } as unknown as CFBFReader;
    const propertyReader = new PropertyReader(
      cfbReader,
      new Decoder(),
      { getCodepage: vi.fn(async () => 1251) } as unknown as CodePageReader,
    );
    const store = new PropertyStore(cfbReader, propertyReader, {} as NamedPropertyReader);

    await expect(store.readString(['0037'])).resolves.toBe('Привет');
  });

  it('preserves surrounding whitespace in ANSI and Unicode properties', async () => {
    const value = '  text \t';
    const tree = node('Root Entry', DirectoryEntryType.Root, [
      node('__substg1.0_0037001E', DirectoryEntryType.Stream),
      node('__substg1.0_0038001F', DirectoryEntryType.Stream),
    ]);
    const cfbReader = {
      getTree: () => tree,
      readStream: vi.fn(async (path: string[]) => path[path.length - 1].endsWith('001E')
        ? Buffer.from(`${value}\0`, 'latin1')
        : Buffer.from(`${value}\0`, 'utf16le')),
    } as unknown as CFBFReader;
    const propertyReader = new PropertyReader(
      cfbReader,
      new Decoder(),
      { getCodepage: vi.fn(async () => 1252) } as unknown as CodePageReader,
    );
    const store = new PropertyStore(cfbReader, propertyReader, {} as NamedPropertyReader);

    await expect(store.readString(['0037'])).resolves.toBe(value);
    await expect(store.readString(['0038'])).resolves.toBe(value);
  });

  it('decodes a binary property when readString accepts type 0102', async () => {
    const tree = node('Root Entry', DirectoryEntryType.Root, [
      node('__substg1.0_00370102', DirectoryEntryType.Stream),
    ]);
    const readStringFromBinary = vi.fn(async () => 'binary subject');
    const readBinary = vi.fn(async () => Buffer.from('binary subject'));
    const store = new PropertyStore(
      { getTree: () => tree } as unknown as CFBFReader,
      { readStringFromBinary, readBinary } as unknown as PropertyReader,
      {} as NamedPropertyReader,
    );

    await expect(store.readString(['0037'])).resolves.toBe('binary subject');
    expect(readStringFromBinary).toHaveBeenCalledWith([
      'Root Entry',
      '__substg1.0_00370102',
    ]);
    expect(readBinary).not.toHaveBeenCalled();
  });

  it('continues to a fallback property when a binary string cannot be decoded', async () => {
    const tree = node('Root Entry', DirectoryEntryType.Root, [
      node('__substg1.0_5D010102', DirectoryEntryType.Stream),
      node('__substg1.0_0C1F001F', DirectoryEntryType.Stream),
    ]);
    const store = new PropertyStore(
      { getTree: () => tree } as unknown as CFBFReader,
      {
        readStringFromBinary: vi.fn(async () => undefined),
        readUnicodeString: vi.fn(async () => 'fallback@example.test'),
      } as unknown as PropertyReader,
      {} as NamedPropertyReader,
    );

    await expect(store.readString(['5D01', '0C1F']))
      .resolves.toBe('fallback@example.test');
  });

  it('prefers the primary ANSI sender address over a fallback Unicode property', async () => {
    const tree = node('Root Entry', DirectoryEntryType.Root, [
      node('__substg1.0_5D01001E', DirectoryEntryType.Stream),
      node('__substg1.0_0C1F001F', DirectoryEntryType.Stream),
    ]);
    const readUnicodeString = vi.fn(async (path: string[]) => {
      if (path[path.length - 1] === '__substg1.0_5D01001E') {
        return 'primary@example.test';
      }
      if (path[path.length - 1] === '__substg1.0_0C1F001F') {
        return 'fallback@example.test';
      }
      return undefined;
    });
    const store = new PropertyStore(
      { getTree: () => tree } as unknown as CFBFReader,
      { readUnicodeString } as unknown as PropertyReader,
      {} as NamedPropertyReader,
    );

    await expect(new SenderReader(store).read()).resolves.toEqual({
      name: '',
      email: 'primary@example.test',
    });
    expect(readUnicodeString).toHaveBeenCalledTimes(1);
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
