import { describe, expect, it, vi } from 'vitest';
import { CFBFReader } from '../src/cfb/CFBReader';
import type { RandomAccessSource } from '../src/cfb/InputSource';
import type { FATReader } from '../src/cfb/readers/fatReader';
import type { HeaderReader } from '../src/cfb/readers/headerReader';
import type { DirectoryReader } from '../src/cfb/readers/directoryReader';
import type { DirectoryNode } from '../src/types';

function createSource() {
  return {
    read: vi.fn(async () => Buffer.alloc(0)),
    close: vi.fn(async () => undefined),
  } satisfies RandomAccessSource;
}

describe('CFBFReader', () => {
  it('decodes PT_STRING8 using the MSG code page', async () => {
    const properties = Buffer.alloc(48);
    properties.writeUInt16LE(0x0003, 32);
    properties.writeUInt16LE(0x3ffd, 34);
    properties.writeInt32LE(1251, 40);
    const reader = new CFBFReader({} as HeaderReader, {} as FATReader, {} as DirectoryReader);
    vi.spyOn(reader, 'readStream').mockImplementation(async (path) =>
      path[path.length - 1] === '__properties_version1.0'
        ? properties
        : Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x00]));

    await expect(reader.readStreamAsString(['Root Entry', '__substg1.0_0037001E'], 0x001E))
      .resolves.toBe('Привет');
  });

  it('uses an embedded message code page for its PT_STRING8 streams', async () => {
    const embeddedStorage = [
      'Root Entry',
      '__attach_version1.0_#00000000',
      '__substg1.0_3701000D',
    ];
    const properties = Buffer.alloc(40);
    properties.writeUInt16LE(0x0003, 24);
    properties.writeUInt16LE(0x3ffd, 26);
    properties.writeInt32LE(1251, 32);
    const reader = new CFBFReader({} as HeaderReader, {} as FATReader, {} as DirectoryReader);
    const readStream = vi.spyOn(reader, 'readStream').mockImplementation(async (path) =>
      path[path.length - 1] === '__properties_version1.0'
        ? properties
        : Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x00]));

    await expect(reader.readStreamAsString([...embeddedStorage, '__substg1.0_0037001E'], 0x001E))
      .resolves.toBe('Привет');
    expect(readStream).toHaveBeenCalledWith([...embeddedStorage, '__properties_version1.0']);
  });

  it('closes the previous input before loading another one', async () => {
    const firstSource = createSource();
    const secondSource = createSource();
    const header = Buffer.alloc(512, 0xff);
    header.writeUInt16LE(3, 0x1a);
    header.writeUInt16LE(9, 0x1e);
    header.writeUInt16LE(6, 0x20);
    const headerReader = {
      readHeaderWithSource: vi.fn()
        .mockResolvedValueOnce({ header, source: firstSource })
        .mockResolvedValueOnce({ header, source: secondSource }),
    } as unknown as HeaderReader;
    const fatReader = { buildTable: vi.fn(async () => undefined) } as unknown as FATReader;
    const tree = {} as DirectoryNode;
    const directoryReader = {
      loadDirectory: vi.fn(async () => undefined),
      getTree: vi.fn(() => tree),
    } as unknown as DirectoryReader;
    const reader = new CFBFReader(headerReader, fatReader, directoryReader);

    await reader.load(Buffer.from('first'));
    expect(firstSource.close).not.toHaveBeenCalled();

    await reader.load(Buffer.from('second'));
    expect(firstSource.close).toHaveBeenCalledTimes(1);
    expect(secondSource.close).not.toHaveBeenCalled();
    expect(reader.getTree()).toBe(tree);

    await reader.close();
    await reader.close();
    expect(secondSource.close).toHaveBeenCalledTimes(1);
    expect(reader.getTree()).toBeNull();
  });
});
