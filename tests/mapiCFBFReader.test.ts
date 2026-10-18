import { describe, expect, it, vi } from 'vitest';
import { CFBFReader } from '../src';
import { CFBFReader as CompoundFileReader } from '../src/cfb/CFBReader';
import type { FATReader } from '../src/cfb/readers/fatReader';
import type { HeaderReader } from '../src/cfb/readers/headerReader';
import type { DirectoryReader } from '../src/cfb/readers/directoryReader';

function createReader(): CFBFReader {
  return new CFBFReader({} as HeaderReader, {} as FATReader, {} as DirectoryReader);
}

describe('public CFBFReader MAPI compatibility', () => {
  it('inherits the raw CFBF reader API', () => {
    expect(createReader()).toBeInstanceOf(CompoundFileReader);
  });

  it('preserves a long embedded NUL run followed by non-padding text', async () => {
    const reader = createReader();
    const value = '\0'.repeat(32_000) + 'X';
    vi.spyOn(reader, 'readStream').mockResolvedValue(Buffer.from(value + '\0', 'utf16le'));
    await expect(reader.readStreamAsString(['Root Entry', '__substg1.0_0037001F'], 0x001F)).resolves.toBe(value);
  });

  it('decodes PT_STRING8 using the MSG code page', async () => {
    const properties = Buffer.alloc(48);
    properties.writeUInt16LE(0x0003, 32);
    properties.writeUInt16LE(0x3ffd, 34);
    properties.writeInt32LE(1251, 40);
    const reader = createReader();
    vi.spyOn(reader, 'readStream').mockImplementation(async (path) =>
      path[path.length - 1] === '__properties_version1.0'
        ? properties
        : Buffer.from([0xcf, 0xf0, 0x00, 0xe8, 0xe2, 0xe5, 0xf2, 0x00]));

    await expect(reader.readStreamAsString(['Root Entry', '__substg1.0_0037001E'], 0x001E))
      .resolves.toBe('Пр\0ивет');
  });

  it('preserves embedded NUL characters and removes UTF-16 padding', async () => {
    const reader = createReader();
    vi.spyOn(reader, 'readStream').mockResolvedValue(Buffer.from('A\0B\0\0', 'utf16le'));

    await expect(reader.readStreamAsString(['Root Entry', '__substg1.0_0037001F'], 0x001F))
      .resolves.toBe('A\0B');
  });

  it.each([true, false])('uses the embedded code page with a root-prefixed path: %s', async (includeRoot) => {
    const embeddedStorage = [
      'Root Entry',
      '__attach_version1.0_#00000000',
      '__substg1.0_3701000D',
    ];
    const properties = Buffer.alloc(40);
    properties.writeUInt16LE(0x0003, 24);
    properties.writeUInt16LE(0x3ffd, 26);
    properties.writeInt32LE(1251, 32);
    const reader = createReader();
    const readStream = vi.spyOn(reader, 'readStream').mockImplementation(async (path) =>
      path.join('/') === [...embeddedStorage, '__properties_version1.0'].join('/')
        ? properties
        : Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x00]));

    const storage = includeRoot ? embeddedStorage : embeddedStorage.slice(1);
    await expect(reader.readStreamAsString([...storage, '__substg1.0_0037001E'], 0x001E))
      .resolves.toBe('Привет');
    expect(readStream).toHaveBeenCalledWith([...embeddedStorage, '__properties_version1.0']);
  });

  it.each([undefined, 0, 0x9999])('keeps UTF-8 fallback decoding for property type %s', async (propertyType) => {
    const reader = createReader();
    vi.spyOn(reader, 'readStream').mockResolvedValue(Buffer.from('Привет\0', 'utf8'));

    await expect(reader.readStreamAsString(['arbitrary stream'], propertyType)).resolves.toBe('Привет\0');
  });

  it('returns binary properties as hex', async () => {
    const reader = createReader();
    vi.spyOn(reader, 'readStream').mockResolvedValue(Buffer.from([0x00, 0xab, 0xff]));

    await expect(reader.readStreamAsString(['binary'], 0x0102)).resolves.toBe('00abff');
  });

  it('returns null for an absent stream', async () => {
    const reader = createReader();
    vi.spyOn(reader, 'readStream').mockResolvedValue(null);

    await expect(reader.readStreamAsString(['missing'], 0x001E)).resolves.toBeNull();
  });
});
