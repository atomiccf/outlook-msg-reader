import { describe, expect, it } from 'vitest';
import { CFBFConstants } from '../src/constants/cfbf';
import { DirectoryReader } from '../src/cfb/readers/directoryReader';
import type { FATReader } from '../src/cfb/readers/fatReader';
import type { MiniFATReader } from '../src/cfb/readers/miniFATReader';
import type { MiniStreamReader } from '../src/cfb/readers/miniStreamReader';
import { DirectoryEntryType, type HeaderInfo } from '../src/types';

const constants = new CFBFConstants();
const NOSTREAM = -1;

function createReader(): DirectoryReader {
  return new DirectoryReader(
    {} as FATReader,
    {} as MiniFATReader,
    {} as MiniStreamReader,
    constants,
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
});
