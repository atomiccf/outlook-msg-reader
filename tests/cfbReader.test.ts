import { describe, expect, it, vi } from 'vitest';
import { CFBFReader } from '../src/cfb/CFBReader';
import type { RandomAccessSource } from '../src/cfb/InputSource';
import type { FATReader } from '../src/cfb/readers/fatReader';
import type { HeaderReader } from '../src/cfb/readers/headerReader';
import type { DirectoryReader } from '../src/cfb/readers/directoryReader';
import { DirectoryEntryType, type DirectoryNode } from '../src/types';
import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { createContainer } from '../src/di/container';
import { TOKENS } from '../src/di/tokens';
import { createRandomAccessSource } from '../src/cfb/InputSource';

const sample = resolve(import.meta.dirname, 'fixtures/valid/outlook/plain-basic-unicode.msg');

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
    const fatReader = { buildTable: vi.fn(async () => undefined), reset: vi.fn() } as unknown as FATReader;
    const tree = {} as DirectoryNode;
    const directoryReader = {
      loadDirectory: vi.fn(async () => undefined),
      getTree: vi.fn(() => tree),
      reset: vi.fn(),
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
      { buildTable: vi.fn(async () => undefined), reset: vi.fn() } as unknown as FATReader,
      {
        loadDirectory: vi.fn(async () => undefined),
        getTree: vi.fn(() => tree),
        findByPath: vi.fn(() => ({ streamSize: 10 })),
        readStreamByPath,
        reset: vi.fn(),
      } as unknown as DirectoryReader,
    );
    await reader.load(Buffer.alloc(0), { maxResultBytes: 2 });

    await expect(reader.readStream(['Root Entry', 'large'])).resolves.toBe(buffer);
    await reader.close();
  });

  it.each(['buffer', 'file', 'readable'] as const)('releases loaded state on close and can reload %s input', async kind => {
    const scope = createContainer().createScope();
    const reader = scope.get(TOKENS.cfbReader);
    const directory = scope.get(TOKENS.directoryReader);
    const miniStream = scope.get(TOKENS.miniStreamReader);
    const miniFat = scope.get(TOKENS.miniFATReader);
    const fat = scope.get(TOKENS.fatReader);
    const input = kind === 'file' ? sample : fs.readFileSync(sample);
    await reader.load(kind === 'readable' ? Readable.from([input]) : input);
    const entry = reader.getTree()!.children.find(node =>
      node.type === DirectoryEntryType.Stream && node.streamSize > 0 && node.streamSize < 4096,
    )!;
    expect(entry).toBeDefined();
    const expected = await reader.readStream([entry.name]);
    expect(miniStream).toHaveProperty('cachedSector.data');
    expect(miniStream).toHaveProperty('input', expect.anything());

    await reader.close();
    await reader.close();

    expect(reader.getTree()).toBeNull();
    expect(() => reader.getHeaderInfo()).toThrow('CFBF is not loaded');
    expect(reader).toHaveProperty('input', undefined);
    expect(reader).toHaveProperty('headerInfo', undefined);
    expect(directory.getTree()).toBeNull();
    expect(directory.findByPath([entry.name])).toBeNull();
    expect(directory).toMatchObject({
      entries: [], nodesBySid: new Map(), childrenByNode: new Map(),
      miniStreamInitialized: false, miniStreamInitialization: undefined,
    });
    expect(miniStream).toMatchObject({
      input: undefined, headerInfo: undefined, cachedSector: undefined,
      rootStartSector: undefined, rootStreamSize: 0, rootSectors: [], visitedRootSectors: new Set(),
    });
    expect(miniFat).toHaveProperty('miniFAT', []);
    expect(fat).toMatchObject({ fatTable: {}, fatEntryCount: 0 });
    await expect(reader.readStream([entry.name])).rejects.toThrow('CFBF is not loaded');

    try {
      await reader.load(sample);
      await expect(reader.readStream([entry.name])).resolves.toEqual(expected);
    } finally {
      await reader.close();
    }
  });

  it('clears reader state even when closing the source fails', async () => {
    const scope = createContainer().createScope();
    const reader = scope.get(TOKENS.cfbReader);
    const input = fs.readFileSync(sample);
    const source = createRandomAccessSource(input, fs);
    const failure = new Error('close failed');
    vi.spyOn(source, 'close').mockRejectedValue(failure);
    vi.spyOn(scope.get(TOKENS.headerReader), 'readHeaderWithSource')
      .mockResolvedValue({ header: input.subarray(0, 512), source });
    await reader.load(input);
    const entry = reader.getTree()!.children.find(node =>
      node.type === DirectoryEntryType.Stream && node.streamSize > 0 && node.streamSize < 4096,
    )!;
    await reader.readStream([entry.name]);

    await expect(reader.close()).rejects.toBe(failure);
    expect(reader.getTree()).toBeNull();
    expect(reader).toHaveProperty('headerInfo', undefined);
    expect(scope.get(TOKENS.miniStreamReader)).toHaveProperty('input', undefined);
    expect(scope.get(TOKENS.miniStreamReader)).toHaveProperty('cachedSector', undefined);
    await expect(reader.close()).resolves.toBeUndefined();
  });
});
