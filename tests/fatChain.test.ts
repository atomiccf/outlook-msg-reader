import { describe, expect, it, vi } from 'vitest';
import * as constants from '../src/constants/cfbf';
import { FATReader } from '../src/cfb/readers/fatReader';
import type { HeaderInfo } from '../src/types';

const sectorSize = 512;

function sectorOffset(sector: number): number {
  return (sector + 1) * sectorSize;
}

function createHeaderInfo(): HeaderInfo {
  return {
    sectorSize,
    miniSectorSize: 64,
    numDirectorySectors: 0,
    dirSectorLocation: 1,
    numFATSectors: 1,
    fatSectorLocations: [0],
    difatStartSector: constants.END_OF_CHAIN,
    numDIFATSectors: 0,
    miniStreamCutoffSize: 4096,
    signature: Buffer.alloc(8),
    rawHeader: Buffer.alloc(512),
    miniFatStartSector: constants.END_OF_CHAIN,
    miniFatSectorCount: 0,
  };
}

function createInput(sectorCount = 4): Buffer {
  const input = Buffer.alloc((sectorCount + 1) * sectorSize, 0);
  input.fill(0xff, sectorOffset(0), sectorOffset(0) + sectorSize);
  input.writeUInt32LE(constants.FAT_SECTOR, sectorOffset(0));
  return input;
}

async function createReader(input: Buffer): Promise<{ reader: FATReader; header: HeaderInfo }> {
  const reader = new FATReader();
  const header = createHeaderInfo();
  await reader.buildTable(input, header);
  return { reader, header };
}

describe('FAT sector chains', () => {
  it('keeps the legacy fs constructor signature compatible', async () => {
    const input = createInput();
    input.writeUInt32LE(constants.END_OF_CHAIN, sectorOffset(0) + 4);
    const reader = new FATReader();
    const header = createHeaderInfo();

    await reader.buildTable(input, header);

    expect(reader.getNextSector(1)).toBeNull();
  });

  it('reads a chain whose length matches the declared stream size', async () => {
    const input = createInput();
    input.writeUInt32LE(2, sectorOffset(0) + 4);
    input.writeUInt32LE(constants.END_OF_CHAIN, sectorOffset(0) + 8);
    input.fill(0x11, sectorOffset(1), sectorOffset(1) + sectorSize);
    input.fill(0x22, sectorOffset(2), sectorOffset(2) + sectorSize);
    const { reader, header } = await createReader(input);

    const chain = await reader.readChain(input, 1, header, sectorSize * 2);

    expect(chain).toHaveLength(sectorSize * 2);
    expect(chain[0]).toBe(0x11);
    expect(chain[sectorSize]).toBe(0x22);
  });

  it('stops an undeclared chain before buffering beyond the limit', async () => {
    const input = createInput();
    input.writeUInt32LE(2, sectorOffset(0) + 4);
    input.writeUInt32LE(constants.END_OF_CHAIN, sectorOffset(0) + 8);
    const { reader, header } = await createReader(input);
    const readSector = vi.spyOn(reader, 'readSector');

    await expect(reader.readChain(input, 1, header, undefined, sectorSize))
      .rejects.toThrow(`CFBF chain exceeds maximum buffered bytes (${sectorSize})`);
    expect(readSector).toHaveBeenCalledTimes(1);
  });

  it('rejects FREESECT inside a chain', async () => {
    const input = createInput();
    input.writeUInt32LE(constants.FREE_SECTOR, sectorOffset(0) + 4);
    const { reader, header } = await createReader(input);

    await expect(reader.readChain(input, 1, header)).rejects.toThrow(
      'FAT chain points to a free sector after sector 1',
    );
  });

  it.each([
    ['FATSECT', constants.FAT_SECTOR],
    ['DIFSECT', constants.DIFAT_SECTOR],
  ])('rejects %s inside a chain', async (_name, marker) => {
    const input = createInput();
    input.writeUInt32LE(marker, sectorOffset(0) + 4);
    const { reader, header } = await createReader(input);

    await expect(reader.readChain(input, 1, header)).rejects.toThrow(
      `FAT chain contains invalid marker 0x${marker.toString(16).toUpperCase()} after sector 1`,
    );
  });

  it('rejects a chain shorter than the declared stream size', async () => {
    const input = createInput();
    input.writeUInt32LE(constants.END_OF_CHAIN, sectorOffset(0) + 4);
    const { reader, header } = await createReader(input);

    await expect(reader.readChain(input, 1, header, sectorSize * 2)).rejects.toThrow(
      'FAT chain ended after 1 sectors; expected 2',
    );
  });

  it('does not read sectors beyond the declared stream size', async () => {
    const input = createInput();
    input.writeUInt32LE(2, sectorOffset(0) + 4);
    input.writeUInt32LE(constants.END_OF_CHAIN, sectorOffset(0) + 8);
    input.fill(0x11, sectorOffset(1), sectorOffset(1) + sectorSize);
    input.fill(0x22, sectorOffset(2), sectorOffset(2) + sectorSize);
    const { reader, header } = await createReader(input);

    const chain = await reader.readChain(input, 1, header, sectorSize);

    expect(chain).toHaveLength(sectorSize);
    expect(chain[0]).toBe(0x11);
    expect(chain).not.toContain(0x22);
  });

  it('streams sectors and trims the final chunk to the declared size', async () => {
    const input = createInput();
    input.writeUInt32LE(2, sectorOffset(0) + 4);
    input.writeUInt32LE(constants.END_OF_CHAIN, sectorOffset(0) + 8);
    input.fill(0x11, sectorOffset(1), sectorOffset(1) + sectorSize);
    input.fill(0x22, sectorOffset(2), sectorOffset(2) + sectorSize);
    const { reader, header } = await createReader(input);

    const chunks: Buffer[] = [];
    for await (const chunk of reader.readChainChunks(input, 1, header, sectorSize + 7)) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.length)).toEqual([sectorSize, 7]);
    expect(chunks[0][0]).toBe(0x11);
    expect(chunks[1][0]).toBe(0x22);
  });

  it('rejects a chain loop', async () => {
    const input = createInput();
    input.writeUInt32LE(2, sectorOffset(0) + 4);
    input.writeUInt32LE(1, sectorOffset(0) + 8);
    const { reader, header } = await createReader(input);

    await expect(reader.readChain(input, 1, header)).rejects.toThrow(
      'FAT sector chain loop detected',
    );
  });

  it('rejects a missing FAT entry', async () => {
    const input = createInput(129);
    input.writeUInt32LE(128, sectorOffset(0) + 127 * 4);
    const { reader, header } = await createReader(input);

    await expect(reader.readChain(input, 127, header)).rejects.toThrow(
      'FAT entry is missing for sector 128',
    );
  });
});
