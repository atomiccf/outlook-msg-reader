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

  it('does not apply the parsed result budget to raw or encoded streams', async () => {
    const source = createSource();
    const header = Buffer.alloc(512, 0xff);
    header.writeUInt16LE(3, 0x1a);
    header.writeUInt16LE(9, 0x1e);
    header.writeUInt16LE(6, 0x20);
    const tree = {} as DirectoryNode;
    const buffer = Buffer.from('Hi\0\0\0', 'utf16le');
    const readStreamByPath = vi.fn(async () => buffer);
    const reader = new CFBFReader(
      { readHeaderWithSource: vi.fn(async () => ({ header, source })) } as unknown as HeaderReader,
      { buildTable: vi.fn(async () => undefined) } as unknown as FATReader,
      {
        loadDirectory: vi.fn(async () => undefined),
        getTree: vi.fn(() => tree),
        findByPath: vi.fn(() => ({ streamSize: 10 })),
        readStreamByPath,
      } as unknown as DirectoryReader,
    );
    await reader.load(Buffer.alloc(0), { maxResultBytes: 2 });

    await expect(reader.readStream(['Root Entry', 'large'])).resolves.toBe(buffer);
    await reader.close();
  });
});
