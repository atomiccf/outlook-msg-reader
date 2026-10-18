import { describe, expect, it } from 'vitest';
import * as constants from '../src/constants/cfbf';
import { FATReader } from '../src/cfb/readers/fatReader';
import { CorruptedSectorChainError } from '../src/errors/errors';
import type { HeaderInfo } from '../src/types';

const sectorSize = 512;

function createHeaderInfo(overrides: Partial<HeaderInfo> = {}): HeaderInfo {
  return {
    sectorSize,
    miniSectorSize: 64,
    numDirectorySectors: 0,
    dirSectorLocation: 0,
    numFATSectors: 0,
    fatSectorLocations: [],
    difatStartSector: constants.END_OF_CHAIN,
    numDIFATSectors: 0,
    miniStreamCutoffSize: 4096,
    signature: Buffer.alloc(8),
    rawHeader: Buffer.alloc(512),
    miniFatStartSector: constants.END_OF_CHAIN,
    miniFatSectorCount: 0,
    ...overrides,
  };
}

function sectorOffset(sector: number): number {
  return (sector + 1) * sectorSize;
}

function createReader(): FATReader {
  return new FATReader();
}

describe('DIFAT parsing', () => {
  it('keeps header DIFAT entries for files without extended DIFAT sectors', async () => {
    const input = Buffer.alloc(2 * sectorSize, 0xff);
    input.writeUInt32LE(constants.END_OF_CHAIN, sectorOffset(0));
    const header = createHeaderInfo({
      numFATSectors: 1,
      fatSectorLocations: [0],
    });
    const reader = createReader();

    await reader.buildTable(input, header);

    expect(header.fatSectorLocations).toEqual([0]);
    expect(reader.getNextSector(0)).toBeNull();
  });

  it('loads FAT sector locations from a multi-sector DIFAT chain', async () => {
    const input = Buffer.alloc(240 * sectorSize, 0xff);
    const headerFatSectors = Array.from({ length: 109 }, (_, i) => i + 2);
    const firstDifatFatSectors = Array.from({ length: 127 }, (_, i) => i + 111);
    const finalFatSector = 238;

    for (let i = 0; i < firstDifatFatSectors.length; i++) {
      input.writeUInt32LE(firstDifatFatSectors[i], sectorOffset(0) + i * 4);
    }
    input.writeUInt32LE(1, sectorOffset(0) + sectorSize - 4);
    input.writeUInt32LE(finalFatSector, sectorOffset(1));
    input.writeUInt32LE(constants.END_OF_CHAIN, sectorOffset(1) + sectorSize - 4);

    input.writeUInt32LE(7, sectorOffset(finalFatSector));

    const header = createHeaderInfo({
      numFATSectors: 237,
      fatSectorLocations: headerFatSectors,
      difatStartSector: 0,
      numDIFATSectors: 2,
    });
    const reader = createReader();

    await reader.buildTable(input, header);

    expect(header.fatSectorLocations).toHaveLength(237);
    expect(header.fatSectorLocations[header.fatSectorLocations.length - 1]).toBe(finalFatSector);
    expect(reader.getNextSector(236 * (sectorSize / 4))).toBe(7);
  });

  it('rejects a loop in the DIFAT sector chain', async () => {
    const input = Buffer.alloc(112 * sectorSize, 0xff);
    input.writeUInt32LE(111, sectorOffset(0));
    input.writeUInt32LE(0, sectorOffset(0) + sectorSize - 4);

    const header = createHeaderInfo({
      numFATSectors: 110,
      fatSectorLocations: Array.from({ length: 109 }, (_, i) => i + 2),
      difatStartSector: 0,
      numDIFATSectors: 2,
    });

    await expect(createReader().buildTable(input, header)).rejects.toThrow(
      new CorruptedSectorChainError('DIFAT sector chain loop detected'),
    );
  });

  it('rejects a FAT sector count that disagrees with the header', async () => {
    const input = Buffer.alloc(2 * sectorSize, 0xff);
    input.writeUInt32LE(constants.END_OF_CHAIN, sectorOffset(0) + sectorSize - 4);

    const header = createHeaderInfo({
      numFATSectors: 1,
      difatStartSector: 0,
      numDIFATSectors: 1,
    });

    await expect(createReader().buildTable(input, header)).rejects.toThrow(
      'FAT sector count mismatch: expected 1, found 0',
    );
  });

  it('rejects a truncated DIFAT sector', async () => {
    const input = Buffer.alloc(sectorOffset(0) + 64, 0xff);
    const header = createHeaderInfo({
      numFATSectors: 1,
      difatStartSector: 0,
      numDIFATSectors: 1,
    });

    await expect(createReader().buildTable(input, header)).rejects.toThrow(
      'Sector 0 is truncated: expected 512 bytes, found 64',
    );
  });
});
