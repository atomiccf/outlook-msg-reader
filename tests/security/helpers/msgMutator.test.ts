import { describe, expect, it } from 'vitest';
import { HEADER_SIZE } from '../../../src/constants/cfbf';
import {
  HEADER,
  buildFatCycle,
  patchUInt16,
  patchUInt32,
  sectorOffset,
  spliceIn,
  truncate,
} from './msgMutator';

function fakeCfb(): Buffer {
  const sectorSize = 512;
  const buf = Buffer.alloc(HEADER_SIZE + sectorSize * 2, 0);
  buf.writeUInt16LE(9, HEADER.sectorShift);
  buf.writeUInt32LE(0, HEADER.difatEntries);
  buf.writeUInt32LE(1, fatNextSlot(buf, 0));
  buf.writeUInt32LE(0xfffffffe, fatNextSlot(buf, 1));
  return buf;
}

function fatNextSlot(buf: Buffer, sector: number): number {
  return sectorOffset(0, 512) + sector * 4;
}

describe('msgMutator', () => {
  it('patches integers on a copy', () => {
    const original = fakeCfb();
    const patched16 = patchUInt16(original, HEADER.sectorShift, 12);
    const patched32 = patchUInt32(original, HEADER.dirStartSector, 7);
    expect(original.readUInt16LE(HEADER.sectorShift)).toBe(9);
    expect(patched16.readUInt16LE(HEADER.sectorShift)).toBe(12);
    expect(patched32.readUInt32LE(HEADER.dirStartSector)).toBe(7);
  });

  it('truncates and splices without mutating the source', () => {
    const original = Buffer.from([1, 2, 3, 4, 5]);
    expect(truncate(original, 3)).toEqual(Buffer.from([1, 2, 3]));
    expect(spliceIn(original, 2, Buffer.from([9, 9]))).toEqual(Buffer.from([1, 2, 9, 9, 3, 4, 5]));
    expect(original).toEqual(Buffer.from([1, 2, 3, 4, 5]));
  });

  it('computes CFBF sector offsets after the 512-byte header', () => {
    expect(sectorOffset(0, 512)).toBe(512);
    expect(sectorOffset(1, 512)).toBe(1024);
  });

  it('points a FAT entry at its own sector', () => {
    const cycled = buildFatCycle(fakeCfb(), 1);
    expect(cycled.readUInt32LE(fatNextSlot(cycled, 1))).toBe(1);
  });
});
