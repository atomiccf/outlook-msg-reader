import { describe, expect, it, vi } from 'vitest';
import * as constants from '../src/constants/cfbf';
import { DirectoryReader } from '../src/cfb/readers/directoryReader';
import type { FATReader } from '../src/cfb/readers/fatReader';
import type { MiniFATReader } from '../src/cfb/readers/miniFATReader';
import type { MiniStreamReader } from '../src/cfb/readers/miniStreamReader';
import type { RandomAccessSource } from '../src/cfb/InputSource';
import { DirectoryEntryType, type HeaderInfo } from '../src/types';

const NOSTREAM = -1;

function createReader(): DirectoryReader {
  return new DirectoryReader(
    {} as FATReader,
    {} as MiniFATReader,
    {} as MiniStreamReader,
  );
}

function writeEntry(
  buffer: Buffer,
  sid: number,
  options: {
    name: string;
    type: DirectoryEntryType;
    left?: number;
    right?: number;
    child?: number;
    streamSize?: bigint;
  },
): void {
  const offset = sid * 128;
  const view = buffer.subarray(offset, offset + 128);
  const encodedName = Buffer.from(`${options.name}\0`, 'utf16le');
  encodedName.copy(view, 0, 0, Math.min(encodedName.length, 64));
  view.writeUInt16LE(encodedName.length, 0x40);
  view.writeUInt8(options.type, 0x42);
  view.writeUInt8(1, 0x43);
  view.writeInt32LE(options.left ?? NOSTREAM, 0x44);
  view.writeInt32LE(options.right ?? NOSTREAM, 0x48);
  view.writeInt32LE(options.child ?? NOSTREAM, 0x4c);
  view.writeBigUInt64LE(options.streamSize ?? 0n, 0x78);
}

function createDirectory(): Buffer {
  const buffer = Buffer.alloc(3 * 128);
  writeEntry(buffer, 0, {
    name: 'Root Entry',
    type: DirectoryEntryType.Root,
    child: 1,
  });
  writeEntry(buffer, 1, {
    name: 'first',
    type: DirectoryEntryType.Stream,
    right: 2,
  });
  writeEntry(buffer, 2, {
    name: 'second',
    type: DirectoryEntryType.Stream,
  });
  return buffer;
}

function version3Header(): HeaderInfo {
  return {
    majorVersion: 3,
    sectorSize: 512,
    miniSectorSize: 64,
    numDirectorySectors: 0,
    dirSectorLocation: 0,
    numFATSectors: 1,
    fatSectorLocations: [0],
    miniStreamCutoffSize: 4096,
    signature: Buffer.alloc(8),
    rawHeader: Buffer.alloc(512),
    miniFatStartSector: constants.END_OF_CHAIN,
    miniFatSectorCount: 0,
  };
}

describe('CFBF directory validation', () => {
  it('indexes paths with and without the root and refreshes them after reload', () => {
    const reader = createReader();
    reader.parseDirectoryEntries(createDirectory());
    reader.buildDirectoryTree();
    expect(reader.findByPath(['Root Entry', 'second'])?.name).toBe('second');
    expect(reader.findByPath(['second'])?.name).toBe('second');
    const next = createDirectory();
    writeEntry(next, 2, { name: 'replacement', type: DirectoryEntryType.Stream });
    reader.parseDirectoryEntries(next);
    reader.buildDirectoryTree();
    expect(reader.findByPath(['second'])).toBeNull();
    expect(reader.findByPath(['replacement'])?.name).toBe('replacement');
  });

  it('does not read a storage node as a stream', async () => {
    const buffer = createDirectory();
    buffer.writeUInt8(DirectoryEntryType.Storage, 128 + 0x42);
    const reader = createReader();
    reader.parseDirectoryEntries(buffer, version3Header());
    reader.buildDirectoryTree();
    const readStreamBySid = vi.spyOn(reader, 'readStreamBySid');

    await expect(reader.readStreamByPath(
      {} as RandomAccessSource,
      version3Header(),
      ['Root Entry', 'first'],
    )).resolves.toBeNull();
    expect(readStreamBySid).not.toHaveBeenCalled();
  });

  it('initializes the MiniFAT once for concurrent mini-stream reads', async () => {
    const buffer = createDirectory();
    buffer.writeBigUInt64LE(4n, 128 + 0x78);
    buffer.writeBigUInt64LE(4n, 256 + 0x78);
    let finishInitialization!: () => void;
    const initialization = new Promise<void>((resolve) => { finishInitialization = resolve; });
    const buildMiniFAT = vi.fn(async () => { await initialization; });
    const loadMiniStream = vi.fn(async () => undefined);
    const readMiniStream = vi.fn(async () => Buffer.from('data'));
    const reader = new DirectoryReader(
      {} as FATReader,
      { buildMiniFAT } as unknown as MiniFATReader,
      { loadMiniStream, readMiniStream } as unknown as MiniStreamReader,
    );
    const header = version3Header();
    reader.parseDirectoryEntries(buffer, header);
    reader.buildDirectoryTree();
    const input = {} as RandomAccessSource;

    const first = reader.readStreamByPath(input, header, ['Root Entry', 'first']);
    const second = reader.readStreamByPath(input, header, ['Root Entry', 'second']);
    expect(buildMiniFAT).toHaveBeenCalledTimes(1);
    finishInitialization();
    await expect(Promise.all([first, second])).resolves.toEqual([
      Buffer.from('data'),
      Buffer.from('data'),
    ]);
    expect(loadMiniStream).toHaveBeenCalledTimes(1);
  });

  it('retries MiniFAT initialization after a failure', async () => {
    const buildMiniFAT = vi.fn()
      .mockRejectedValueOnce(new Error('initialization failed'))
      .mockResolvedValueOnce(undefined);
    const loadMiniStream = vi.fn(async () => undefined);
    const reader = new DirectoryReader(
      {} as FATReader,
      { buildMiniFAT } as unknown as MiniFATReader,
      { loadMiniStream } as unknown as MiniStreamReader,
    );
    const header = version3Header();
    reader.parseDirectoryEntries(createDirectory(), header);
    reader.buildDirectoryTree();
    const input = {} as RandomAccessSource;

    await expect(reader.initializeMiniStream(input, header)).rejects.toThrow('initialization failed');
    await expect(reader.initializeMiniStream(input, header)).resolves.toBeUndefined();
    expect(buildMiniFAT).toHaveBeenCalledTimes(2);
    expect(loadMiniStream).toHaveBeenCalledTimes(1);
  });

  it('builds a tree from valid directory entries', () => {
    const reader = createReader();
    reader.parseDirectoryEntries(createDirectory(), version3Header());

    const root = reader.buildDirectoryTree();

    expect(root?.name).toBe('Root Entry');
    expect(root?.children.map(child => child.name)).toEqual(['first', 'second']);
  });

  it('rejects a missing SID reference', () => {
    const buffer = createDirectory();
    buffer.writeInt32LE(99, 0x4c);
    const reader = createReader();
    reader.parseDirectoryEntries(buffer, version3Header());

    expect(() => reader.buildDirectoryTree()).toThrow(
      'Directory SID 99 does not reference an active entry',
    );
  });

  it('rejects a sibling tree loop', () => {
    const buffer = createDirectory();
    buffer.writeInt32LE(1, 128 + 0x44);
    const reader = createReader();
    reader.parseDirectoryEntries(buffer, version3Header());

    expect(() => reader.buildDirectoryTree()).toThrow(
      'Directory sibling tree loop detected at SID 1',
    );
  });

  it('rejects a root entry outside SID 0', () => {
    const buffer = createDirectory();
    buffer.writeUInt8(DirectoryEntryType.Storage, 0x42);
    const reader = createReader();
    reader.parseDirectoryEntries(buffer, version3Header());

    expect(() => reader.buildDirectoryTree()).toThrow(
      'Directory SID 0 must be the Root Entry',
    );
  });

  it('rejects malformed directory entry names', () => {
    const buffer = createDirectory();
    buffer.writeUInt16LE(3, 128 + 0x40);

    expect(() => createReader().parseDirectoryEntries(buffer, version3Header())).toThrow(
      'Invalid directory entry name length 3 at SID 1',
    );
  });

  it('rejects version 3 stream sizes larger than 32 bits', () => {
    const buffer = createDirectory();
    buffer.writeBigUInt64LE(0x1_0000_0000n, 128 + 0x78);

    expect(() => createReader().parseDirectoryEntries(buffer, version3Header())).toThrow(
      'Version 3 directory entry SID 1 has a stream size larger than 32 bits',
    );
  });

  it('rejects directory nesting beyond the configured depth', () => {
    const buffer = Buffer.alloc(4 * 128);
    writeEntry(buffer, 0, {
      name: 'Root Entry',
      type: DirectoryEntryType.Root,
      child: 1,
    });
    writeEntry(buffer, 1, {
      name: 'level-1',
      type: DirectoryEntryType.Storage,
      child: 2,
    });
    writeEntry(buffer, 2, {
      name: 'level-2',
      type: DirectoryEntryType.Storage,
      child: 3,
    });
    writeEntry(buffer, 3, {
      name: 'level-3',
      type: DirectoryEntryType.Stream,
    });
    const reader = createReader();
    reader.parseDirectoryEntries(buffer, version3Header());

    expect(() => reader.buildDirectoryTree(2)).toThrow(
      'Directory depth exceeds maxDirectoryDepth (2)',
    );
  });
});
