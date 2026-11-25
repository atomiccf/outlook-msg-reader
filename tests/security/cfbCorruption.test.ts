import { describe, expect, it } from 'vitest';
import {
  CorruptedSectorChainError,
  InvalidCfbfError,
  createMsgReader,
  parseMsg,
} from '../../src';
import { END_OF_CHAIN, FREE_SECTOR } from '../../src/constants/cfbf';
import { expectControlledFailure } from './helpers/expectations';
import { loadFixture, validFixtures } from './helpers/fixtures';
import {
  HEADER,
  buildFatCycle,
  buildFatMutualCycle,
  fatEntryOffset,
  patchUInt32,
  sectorOffset,
  sectorSizeOf,
  truncate,
} from './helpers/msgMutator';

const CFB_ERRORS = [CorruptedSectorChainError, InvalidCfbfError];
const DEADLINE = 2000;

function sample(): Buffer {
  return loadFixture(validFixtures()[0].id);
}

function lastSector(buf: Buffer): number {
  return buf.length / sectorSizeOf(buf) - 2;
}

async function expectCfbError(fn: () => Promise<unknown>, klass: (typeof CFB_ERRORS)[number]): Promise<void> {
  const error = await expectControlledFailure(fn, CFB_ERRORS, DEADLINE);
  expect(error).toBeInstanceOf(klass);
}

describe('CFB corruption', () => {
  it('rejects a FAT self-loop', async () => {
    const buf = sample();
    const dir = buf.readUInt32LE(HEADER.dirStartSector);
    await expectCfbError(() => parseMsg(buildFatCycle(buf, dir)), CorruptedSectorChainError);
  });

  it('rejects a two-sector FAT cycle', async () => {
    const buf = sample();
    const a = buf.readUInt32LE(HEADER.dirStartSector);
    const b = buf.readUInt32LE(HEADER.miniFatStart);
    await expectCfbError(() => parseMsg(buildFatMutualCycle(buf, a, b)), CorruptedSectorChainError);
  });

  it('rejects a DIFAT sector that points at itself', async () => {
    const buf = Buffer.from(sample());
    const sectorSize = sectorSizeOf(buf);
    const difat = lastSector(buf);
    buf.fill(0xff, sectorOffset(difat, sectorSize), sectorOffset(difat, sectorSize) + sectorSize);
    buf.writeUInt32LE(difat, sectorOffset(difat, sectorSize) + sectorSize - 4);
    const mutated = patchUInt32(patchUInt32(buf, HEADER.difatStart, difat), HEADER.difatCount, 1);
    await expectCfbError(() => parseMsg(mutated), CorruptedSectorChainError);
  });

  it('rejects a MiniFAT sector chain loop', async () => {
    const buf = sample();
    const start = buf.readUInt32LE(HEADER.miniFatStart);
    const cycled = patchUInt32(buildFatCycle(buf, start), HEADER.miniFatCount, 2);
    await expectCfbError(() => parseMsg(cycled), CorruptedSectorChainError);
  });

  it.each([END_OF_CHAIN, FREE_SECTOR])('rejects dirStartSector 0x%s', async (marker) => {
    const mutated = patchUInt32(sample(), HEADER.dirStartSector, marker);
    await expectCfbError(() => parseMsg(mutated), CorruptedSectorChainError);
  });

  it('rejects a FAT entry that points past the file', async () => {
    const buf = Buffer.from(sample());
    const dir = buf.readUInt32LE(HEADER.dirStartSector);
    buf.writeUInt32LE(0x7fffffff, fatEntryOffset(buf, dir));
    await expectCfbError(() => parseMsg(buf), CorruptedSectorChainError);
  });

  it('rejects numFATSectors larger than the file can hold', async () => {
    const mutated = patchUInt32(sample(), HEADER.numFATSectors, 0xffff);
    await expectCfbError(() => parseMsg(mutated), CorruptedSectorChainError);
  });

  it.each([
    { label: 'quarter length', len: (buf: Buffer) => Math.floor(buf.length / 4), klass: CorruptedSectorChainError },
    { label: '511 bytes', len: () => 511, klass: InvalidCfbfError },
    { label: '512 bytes', len: () => 512, klass: CorruptedSectorChainError },
    { label: '513 bytes', len: () => 513, klass: CorruptedSectorChainError },
  ])('rejects a file truncated to $label', async ({ len, klass }) => {
    const buf = sample();
    await expectCfbError(() => parseMsg(truncate(buf, len(buf))), klass);
  });

  it('rejects a duplicated FAT location in header DIFAT', async () => {
    const buf = Buffer.from(sample());
    const fat0 = buf.readUInt32LE(HEADER.difatEntries);
    buf.writeUInt32LE(fat0, HEADER.difatEntries + 4);
    const mutated = patchUInt32(buf, HEADER.numFATSectors, 2);
    await expectCfbError(() => createMsgReader(mutated).then((reader) => reader.parse()), CorruptedSectorChainError);
  });

  it('rejects a directory childSid that points at the root ancestor', async () => {
    const buf = Buffer.from(sample());
    const dir = buf.readUInt32LE(HEADER.dirStartSector);
    const size = sectorSizeOf(buf);
    buf.writeInt32LE(0, sectorOffset(dir, size) + 0x4c);
    await expectCfbError(() => parseMsg(buf), CorruptedSectorChainError);
  });
});
