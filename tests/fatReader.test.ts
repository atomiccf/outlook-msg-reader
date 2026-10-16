import { describe, expect, it } from 'vitest';
import { FATReader } from '../src/cfb/readers/fatReader';
import type { HeaderInfo } from '../src/types';

describe('FATReader', () => {
  it('maps FAT entries by DIFAT order instead of the physical FAT sector number', async () => {
    const sectorSize = 512;
    const physicalFatSector = 5;
    const input = Buffer.alloc((physicalFatSector + 2) * sectorSize, 0xff);
    const fatOffset = (physicalFatSector + 1) * sectorSize;

    input.writeUInt32LE(7, fatOffset);
    input.writeUInt32LE(0xfffffffe, fatOffset + 4);

    const headerInfo: HeaderInfo = {
      sectorSize,
      miniSectorSize: 64,
      numDirectorySectors: 0,
      dirSectorLocation: 0,
      numFATSectors: 1,
      fatSectorLocations: [physicalFatSector],
      miniStreamCutoffSize: 4096,
      signature: Buffer.alloc(8),
      rawHeader: Buffer.alloc(512),
      miniFatStartSector: 0xfffffffe,
      miniFatSectorCount: 0,
    };

    const reader = new FATReader({} as typeof import('node:fs'));
    await reader.buildTable(input, headerInfo);

    expect(reader.getNextSector(0)).toBe(7);
    expect(reader.getNextSector(1)).toBeNull();
  });
});
