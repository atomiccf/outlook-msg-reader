export const HEADER = {
  signature: 0x00,
  sectorShift: 0x1e,
  numFATSectors: 0x2c,
  dirStartSector: 0x30,
  miniFatStart: 0x3c,
  miniFatCount: 0x40,
  difatStart: 0x44,
  difatCount: 0x48,
  difatEntries: 0x4c,
} as const;

const HEADER_DIFAT_COUNT = 109;

export function cloneBuf(buf: Buffer): Buffer {
  return Buffer.from(buf);
}

export function sectorSizeOf(buf: Buffer): number {
  return 1 << buf.readUInt16LE(HEADER.sectorShift);
}

export function sectorOffset(sector: number, sectorSize: number): number {
  return (sector + 1) * sectorSize;
}

export function patchUInt16(buf: Buffer, off: number, value: number): Buffer {
  const out = cloneBuf(buf);
  out.writeUInt16LE(value, off);
  return out;
}

export function patchUInt32(buf: Buffer, off: number, value: number): Buffer {
  const out = cloneBuf(buf);
  out.writeUInt32LE(value, off);
  return out;
}

export function truncate(buf: Buffer, len: number): Buffer {
  return cloneBuf(buf).subarray(0, len);
}

export function spliceIn(buf: Buffer, off: number, bytes: Buffer): Buffer {
  return Buffer.concat([buf.subarray(0, off), bytes, buf.subarray(off)]);
}

export function repeatSector(buf: Buffer, sector: number, times: number): Buffer {
  const sectorSize = sectorSizeOf(buf);
  const start = sectorOffset(sector, sectorSize);
  const slice = buf.subarray(start, start + sectorSize);
  const copies: Buffer[] = [];
  for (let i = 0; i < times; i += 1) {
    copies.push(Buffer.from(slice));
  }
  return Buffer.concat([buf, ...copies]);
}

export function fatEntryOffset(buf: Buffer, sector: number): number {
  const sectorSize = sectorSizeOf(buf);
  const entriesPerFat = sectorSize / 4;
  const fatIndex = Math.floor(sector / entriesPerFat);
  if (fatIndex >= HEADER_DIFAT_COUNT) {
    throw new Error(`FAT index ${fatIndex} is beyond the 109 header DIFAT entries`);
  }
  const fatSector = buf.readUInt32LE(HEADER.difatEntries + fatIndex * 4);
  const entryInSector = sector % entriesPerFat;
  return sectorOffset(fatSector, sectorSize) + entryInSector * 4;
}

export function buildFatCycle(buf: Buffer, sector: number): Buffer {
  const out = cloneBuf(buf);
  out.writeUInt32LE(sector, fatEntryOffset(out, sector));
  return out;
}

export function buildFatMutualCycle(buf: Buffer, a: number, b: number): Buffer {
  const out = cloneBuf(buf);
  out.writeUInt32LE(b, fatEntryOffset(out, a));
  out.writeUInt32LE(a, fatEntryOffset(out, b));
  return out;
}
