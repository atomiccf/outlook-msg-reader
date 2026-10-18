import { describe, expect, it, vi } from 'vitest';
import type { CFBFReader } from '../src/cfb/CFBReader';
import type { CodePageReader } from '../src/mapi/CodePageReader';
import { PropertyReader } from '../src/mapi/PropertyReader';
import type { Decoder } from '../src/encoding/decoder';

function createReader(value: Buffer): PropertyReader {
  return new PropertyReader(
    { readStream: vi.fn(async () => value) } as unknown as CFBFReader,
    {} as Decoder,
    {} as CodePageReader,
  );
}

describe('PropertyReader binary strings', () => {
  it('preserves a long embedded NUL run followed by non-padding text', async () => {
    const value = '\0'.repeat(32_000) + 'X';
    const reader = createReader(Buffer.from(value + '\0', 'utf16le'));
    await expect(reader.readUnicodeString(['Root Entry', '__substg1.0_0037001F'])).resolves.toBe(value);
    await expect(reader.readStringFromBinary(['Root Entry', '__substg1.0_00370102'])).resolves.toBe(value);
  });

  it('decodes a short UTF-8 value as UTF-8', async () => {
    const reader = createReader(Buffer.from('Hello', 'utf8'));

    await expect(reader.readStringFromBinary(['Root Entry', '__substg1.0_00370102']))
      .resolves.toBe('Hello');
  });

  it('keeps decoding UTF-16LE without a BOM', async () => {
    const reader = createReader(Buffer.from('Hello\0', 'utf16le'));

    await expect(reader.readStringFromBinary(['Root Entry', '__substg1.0_00370102']))
      .resolves.toBe('Hello');
  });
});
