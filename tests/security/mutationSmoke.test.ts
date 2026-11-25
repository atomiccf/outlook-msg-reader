import { describe, expect, it } from 'vitest';
import { createMsgReader, parseMsg } from '../../src';
import { DEFAULT_ALLOWED_ERRORS, expectControlledFailure } from './helpers/expectations';
import { loadFixture, validFixtures } from './helpers/fixtures';
import {
  HEADER,
  buildFatCycle,
  fatEntryOffset,
  patchUInt32,
  repeatSector,
  sectorOffset,
  sectorSizeOf,
  spliceIn,
  truncate,
} from './helpers/msgMutator';

function xorshift32(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function mutateHeader(buf: Buffer, rand: () => number): Buffer {
  const out = Buffer.from(buf);
  const len = Math.min(512, out.length) || 1;
  const offset = rand() % len;
  out[offset] = out[offset] ^ (1 << (rand() % 8));
  return out;
}

function mutateTail(buf: Buffer, rand: () => number): Buffer {
  if (buf.length <= 512) return mutateHeader(buf, rand);
  const out = Buffer.from(buf);
  const offset = 512 + (rand() % (out.length - 512));
  out[offset] = out[offset] ^ (1 << (rand() % 8));
  return out;
}

function mutateFat(buf: Buffer, rand: () => number): Buffer {
  try {
    const offset = fatEntryOffset(buf, rand() % 8);
    if (offset < 0 || offset >= buf.length) return mutateHeader(buf, rand);
    const out = Buffer.from(buf);
    out[offset] = out[offset] ^ 1;
    return out;
  } catch {
    return mutateHeader(buf, rand);
  }
}

function mutateDirectory(buf: Buffer, rand: () => number): Buffer {
  try {
    const sectorSize = sectorSizeOf(buf);
    const start = sectorOffset(buf.readUInt32LE(HEADER.dirStartSector), sectorSize);
    if (start < 0 || start >= buf.length) return mutateHeader(buf, rand);
    const span = Math.min(sectorSize, buf.length - start);
    const out = Buffer.from(buf);
    const offset = start + (rand() % span);
    out[offset] = out[offset] ^ 1;
    return out;
  } catch {
    return mutateHeader(buf, rand);
  }
}

function mutateLegacy(buf: Buffer, rand: () => number): Buffer {
  const kind = rand() % 6;
  if (kind === 0) {
    const out = Buffer.from(buf);
    const offset = rand() % out.length;
    out[offset] = out[offset] ^ (1 << (rand() % 8));
    return out;
  }
  if (kind === 1) {
    const out = Buffer.from(buf);
    out[rand() % out.length] = rand() & 0xff;
    return out;
  }
  if (kind === 2) {
    return spliceIn(buf, rand() % buf.length, Buffer.from([rand() & 0xff]));
  }
  if (kind === 3) {
    const len = Math.max(1, rand() % buf.length);
    return truncate(buf, len);
  }
  if (kind === 4) {
    return repeatSector(buf, 0, 1 + (rand() % 3));
  }
  const fields = [
    HEADER.numFATSectors,
    HEADER.dirStartSector,
    HEADER.miniFatStart,
    HEADER.miniFatCount,
    HEADER.difatStart,
    HEADER.difatCount,
  ];
  if (rand() % 2 === 0) {
    return patchUInt32(buf, fields[rand() % fields.length], rand());
  }
  try {
    return buildFatCycle(buf, rand() % 8);
  } catch {
    return patchUInt32(buf, HEADER.dirStartSector, rand());
  }
}

function mutate(buf: Buffer, rand: () => number): Buffer {
  const strategy = rand() % 5;
  if (strategy === 0) return mutateTail(buf, rand);
  if (strategy === 1) return mutateFat(buf, rand);
  if (strategy === 2) return mutateDirectory(buf, rand);
  if (strategy === 3) return mutateHeader(buf, rand);
  return mutateLegacy(buf, rand);
}

describe('mutation smoke', () => {
  it('parses mutated fixtures without hanging or throwing non-Errors', async () => {
    const iterations = Number.parseInt(process.env.SECURITY_FUZZ_ITERATIONS ?? '300', 10);
    const seed = Number.parseInt(process.env.SECURITY_FUZZ_SEED ?? '0xC0FFEE', 16);
    const minReachedEnv = process.env.SECURITY_FUZZ_MIN_REACHED;
    const minReached = minReachedEnv === undefined
      ? iterations * 0.1
      : Number.parseInt(minReachedEnv, 10);
    const rand = xorshift32(seed);
    const ids = validFixtures().map((fixture) => fixture.id);
    const opts = { maxInputBytes: 0, maxResultBytes: 8 * 1024 * 1024 };
    let reached = 0;
    for (let i = 0; i < iterations; i += 1) {
      const id = ids[rand() % ids.length];
      const buf = mutate(loadFixture(id), rand);
      opts.maxInputBytes = buf.length;
      try {
        const reader = await createMsgReader(buf, opts);
        reached += 1;
        await reader.close();
      } catch {
        // Invalid CFBF after mutation never reaches a live reader.
      }
      try {
        await expectControlledFailure(
          () => parseMsg(buf, opts),
          DEFAULT_ALLOWED_ERRORS,
          2000,
        );
      } catch (error) {
        expect.fail(
          `mutation ${i} seed=0x${seed.toString(16)} fixture=${id}: ${
            error instanceof Error ? error.stack ?? error.message : String(error)
          }`,
        );
      }
    }
    expect(reached).toBeGreaterThan(minReached);
  });
});
