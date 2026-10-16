import { describe, expect, it } from 'vitest';
import { CFBFConstants } from '../src/constants/cfbf';
import { FATReader } from '../src/cfb/readers/fatReader';
import { MiniFATReader } from '../src/cfb/readers/miniFATReader';
import { MiniStreamReader } from '../src/cfb/readers/miniStreamReader';
import type { HeaderInfo } from '../src/types';

const constants = new CFBFConstants();
const sectorSize = 512;

function sectorOffset(sector: number): number {
  return (sector + 1) * sectorSize;
}

function createHeaderInfo(overrides: Partial<HeaderInfo> = {}): HeaderInfo {
  return {
    sectorSize,
    miniSectorSize: 64,
    numDirectorySectors: 0,
    dirSectorLocation: 2,
    numFATSectors: 1,
    fatSectorLocations: [0],
    difatStartSector: constants.END_OF_CHAIN,
    numDIFATSectors: 0,
    miniStreamCutoffSize: 4096,
    signature: Buffer.alloc(8),
    rawHeader: Buffer.alloc(512),
    miniFatStartSector: 1,
    miniFatSectorCount: 1,
    ...overrides,
  };
}

function createInput(fatNext = constants.END_OF_CHAIN): Buffer {
  const input = Buffer.alloc(4 * sectorSize, 0xff);
  input.writeUInt32LE(constants.FAT_SECTOR, sectorOffset(0));
  input.writeUInt32LE(fatNext, sectorOffset(0) + 4);
  return input;
}

async function createMiniFAT(
  input: Buffer,
  header = createHeaderInfo(),
): Promise<MiniFATReader> {
  const fat = new FATReader(constants);
  await fat.buildTable(input, header);
  const miniFat = new MiniFATReader(fat, constants);
  await miniFat.buildMiniFAT(input, header);
  return miniFat;
}

describe('MiniFAT validation', () => {
  it('reads a MiniFAT chain with the declared length', async () => {
    const input = createInput();
    input.writeUInt32LE(1, sectorOffset(1));
    input.writeUInt32LE(constants.END_OF_CHAIN, sectorOffset(1) + 4);
    const miniFat = await createMiniFAT(input);

    expect(miniFat.getNextMiniSector(0)).toBe(1);
    expect(miniFat.getNextMiniSector(1)).toBeNull();
  });

  it('rejects a missing MiniFAT start sector', async () => {
    const input = createInput();
    const header = createHeaderInfo({ miniFatStartSector: constants.END_OF_CHAIN });
    const fat = new FATReader(constants);
    await fat.buildTable(input, header);
    const miniFat = new MiniFATReader(fat, constants);

    await expect(miniFat.buildMiniFAT(input, header)).rejects.toThrow(
      'MiniFAT chain is missing its first sector',
    );
  });

  it('rejects a MiniFAT chain shorter than its declared sector count', async () => {
    const input = createInput();
    const header = createHeaderInfo({ miniFatSectorCount: 2 });
    const fat = new FATReader(constants);
    await fat.buildTable(input, header);
    const miniFat = new MiniFATReader(fat, constants);

    await expect(miniFat.buildMiniFAT(input, header)).rejects.toThrow(
      'MiniFAT chain ended after 1 sectors; expected 2',
    );
  });

  it('rejects FREESECT inside a mini-sector chain', async () => {
    const input = createInput();
    input.writeUInt32LE(constants.FREE_SECTOR, sectorOffset(1));
    const miniFat = await createMiniFAT(input);

    expect(() => miniFat.getNextMiniSector(0)).toThrow(
      'MiniFAT chain points to a free sector after sector 0',
    );
  });
});

describe('mini stream validation', () => {
  it('reads a fragmented mini-sector chain', async () => {
    const input = createInput();
    input.writeUInt32LE(1, sectorOffset(1));
    input.writeUInt32LE(constants.END_OF_CHAIN, sectorOffset(1) + 4);
    const miniFat = await createMiniFAT(input);
    const reader = new MiniStreamReader(miniFat);
    const rootStream = Buffer.alloc(128);
    rootStream.fill(0x11, 0, 64);
    rootStream.fill(0x22, 64, 128);
    await reader.loadMiniStream(rootStream, 64);

    const result = reader.readMiniStream({ startingSectorLocation: 0, streamSize: 128 });

    expect(result[0]).toBe(0x11);
    expect(result[64]).toBe(0x22);
  });

  it('rejects a mini-sector outside the root mini stream', async () => {
    const input = createInput();
    input.writeUInt32LE(2, sectorOffset(1));
    input.writeUInt32LE(constants.END_OF_CHAIN, sectorOffset(1) + 8);
    const miniFat = await createMiniFAT(input);
    const reader = new MiniStreamReader(miniFat);
    await reader.loadMiniStream(Buffer.alloc(64), 64);

    expect(() => reader.readMiniStream({ startingSectorLocation: 0, streamSize: 128 })).toThrow(
      'Mini stream sector 2 exceeds the root mini stream bounds',
    );
  });

  it('rejects a mini-sector chain that ends before the stream size', async () => {
    const input = createInput();
    input.writeUInt32LE(constants.END_OF_CHAIN, sectorOffset(1));
    const miniFat = await createMiniFAT(input);
    const reader = new MiniStreamReader(miniFat);
    await reader.loadMiniStream(Buffer.alloc(128), 64);

    expect(() => reader.readMiniStream({ startingSectorLocation: 0, streamSize: 128 })).toThrow(
      'MiniFAT chain ended after 64 bytes; expected 128',
    );
  });

  it('rejects a mini-sector chain loop', async () => {
    const input = createInput();
    input.writeUInt32LE(1, sectorOffset(1));
    input.writeUInt32LE(0, sectorOffset(1) + 4);
    const miniFat = await createMiniFAT(input);
    const reader = new MiniStreamReader(miniFat);
    await reader.loadMiniStream(Buffer.alloc(192), 64);

    expect(() => reader.readMiniStream({ startingSectorLocation: 0, streamSize: 192 })).toThrow(
      'MiniFAT sector chain loop detected',
    );
  });
});
