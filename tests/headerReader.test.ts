import { describe, expect, it } from 'vitest';
import type * as fs from 'node:fs';
import { HeaderReader } from '../src/cfb/readers/headerReader';
import * as constants from '../src/constants/cfbf';
import { InvalidCfbfError } from '../src/errors/errors';


function createHeader(majorVersion: 3 | 4 = 3): Buffer {
  const header = Buffer.alloc(constants.HEADER_SIZE);
  Buffer.from(constants.CFBF_SIGNATURE).copy(header);
  header.writeUInt16LE(0x003e, 0x18);
  header.writeUInt16LE(majorVersion, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(majorVersion === 3 ? 9 : 12, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(0x1000, 0x38);
  header.writeUInt32LE(constants.END_OF_CHAIN, 0x3c);
  header.writeUInt32LE(constants.END_OF_CHAIN, 0x44);
  header.fill(0xff, 0x4c);
  return header;
}

function createReader(): HeaderReader {
  return new HeaderReader({} as typeof fs);
}

describe('CFBF header validation', () => {
  it.each([3, 4] as const)('accepts a valid version %i header', async majorVersion => {
    const { header } = await createReader().readHeaderWithSource(createHeader(majorVersion));
    expect(header.readUInt16LE(0x1a)).toBe(majorVersion);
  });

  it('rejects unsupported major versions', async () => {
    const header = createHeader();
    header.writeUInt16LE(5, 0x1a);

    await expect(createReader().readHeaderWithSource(header)).rejects.toThrow(
      new InvalidCfbfError('Unsupported CFBF major version: 5'),
    );
  });

  it('rejects a non-little-endian byte order', async () => {
    const header = createHeader();
    header.writeUInt16LE(0xfeff, 0x1c);

    await expect(createReader().readHeaderWithSource(header)).rejects.toThrow(
      'Invalid CFBF byte order: 0xfeff',
    );
  });

  it('rejects a sector shift that does not match the major version', async () => {
    const header = createHeader(4);
    header.writeUInt16LE(9, 0x1e);

    await expect(createReader().readHeaderWithSource(header)).rejects.toThrow(
      'Invalid sector shift 9 for CFBF version 4',
    );
  });

  it('rejects an invalid mini sector shift', async () => {
    const header = createHeader();
    header.writeUInt16LE(7, 0x20);

    await expect(createReader().readHeaderWithSource(header)).rejects.toThrow(
      'Invalid mini sector shift: 7',
    );
  });

  it('rejects a non-zero header CLSID', async () => {
    const header = createHeader();
    header[0x08] = 1;

    await expect(createReader().readHeaderWithSource(header)).rejects.toThrow(
      'CFBF header CLSID must be zero',
    );
  });

  it('rejects non-zero reserved bytes', async () => {
    const header = createHeader();
    header[0x22] = 1;

    await expect(createReader().readHeaderWithSource(header)).rejects.toThrow(
      'CFBF header reserved bytes must be zero',
    );
  });

  it('rejects directory sectors declared by a version 3 header', async () => {
    const header = createHeader(3);
    header.writeUInt32LE(1, 0x28);

    await expect(createReader().readHeaderWithSource(header)).rejects.toThrow(
      'Version 3 CFBF files must declare zero directory sectors',
    );
  });

  it('rejects a non-standard mini stream cutoff', async () => {
    const header = createHeader();
    header.writeUInt32LE(2048, 0x38);

    await expect(createReader().readHeaderWithSource(header)).rejects.toThrow(
      'Invalid mini stream cutoff: 2048',
    );
  });
});
