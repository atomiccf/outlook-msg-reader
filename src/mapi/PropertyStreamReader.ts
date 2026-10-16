import type { CFBFReader } from '../cfb/CFBReader';
import { PropertyDecodeError } from '../errors/errors';

export type FixedPropertyValue = number | bigint | boolean | Date;

interface FixedPropertyEntry {
  id: string;
  type: number;
  value: FixedPropertyValue;
}

/** Reads fixed-length MAPI values stored inline in __properties_version1.0. */
export class PropertyStreamReader {
  private readonly cache = new Map<string, Promise<Map<string, FixedPropertyEntry>>>();

  constructor(private readonly cfbReader: CFBFReader) {}

  async read(storagePath: string[], ids: string[]): Promise<FixedPropertyValue | undefined> {
    return (await this.readEntry(storagePath, ids))?.value;
  }

  async readNumber(storagePath: string[], ids: string[]): Promise<number | undefined> {
    const propertyValue = await this.read(storagePath, ids);
    if (typeof propertyValue === 'number') return propertyValue;
    if (typeof propertyValue === 'bigint') {
      const value = Number(propertyValue);
      return Number.isSafeInteger(value) ? value : undefined;
    }
    return undefined;
  }

  async readBoolean(storagePath: string[], ids: string[]): Promise<boolean | undefined> {
    const propertyValue = await this.read(storagePath, ids);
    return typeof propertyValue === 'boolean' ? propertyValue : undefined;
  }

  private async readEntry(storagePath: string[], ids: string[]): Promise<FixedPropertyEntry | undefined> {
    const entries = await this.getEntries(storagePath);
    for (const id of ids) {
      const entry = entries.get(id.toUpperCase().padStart(4, '0'));
      if (entry) return entry;
    }
    return undefined;
  }

  private getEntries(storagePath: string[]): Promise<Map<string, FixedPropertyEntry>> {
    const key = storagePath.join('\u0000');
    const existing = this.cache.get(key);
    if (existing) return existing;
    const result = this.loadEntries(storagePath);
    this.cache.set(key, result);
    return result;
  }

  private async loadEntries(storagePath: string[]): Promise<Map<string, FixedPropertyEntry>> {
    const stream = await this.cfbReader.readStream([...storagePath, '__properties_version1.0']);
    const result = new Map<string, FixedPropertyEntry>();
    if (!stream) return result;

    const headerSize = this.getHeaderSize(storagePath);
    if (stream.length < headerSize || (stream.length - headerSize) % 16 !== 0) {
      throw new PropertyDecodeError(`Invalid property stream at ${storagePath.join(' / ')}`);
    }

    for (let offset = headerSize; offset + 16 <= stream.length; offset += 16) {
      const type = stream.readUInt16LE(offset);
      const id = stream.readUInt16LE(offset + 2).toString(16).toUpperCase().padStart(4, '0');
      const value = this.decodeFixedValue(stream, offset + 8, type);
      if (value !== undefined) result.set(id, { id, type, value });
    }
    return result;
  }

  private getHeaderSize(storagePath: string[]): number {
    const storage = storagePath[storagePath.length - 1] ?? '';
    if (storage === 'Root Entry') return 32;
    if (storage.startsWith('__recip_version1.0_') || storage.startsWith('__attach_version1.0_')) return 8;
    if (storage === '__substg1.0_3701000D') return 24;
    return 8;
  }

  private decodeFixedValue(buffer: Buffer, offset: number, type: number): FixedPropertyValue | undefined {
    switch (type) {
      case 0x0002: return buffer.readInt16LE(offset);
      case 0x0003: return buffer.readInt32LE(offset);
      case 0x0004: return buffer.readFloatLE(offset);
      case 0x0005: return buffer.readDoubleLE(offset);
      case 0x0006: return buffer.readBigInt64LE(offset);
      case 0x0007: return new Date((buffer.readDoubleLE(offset) - 25569) * 86_400_000);
      case 0x000a: return buffer.readUInt32LE(offset);
      case 0x000b: return buffer.readUInt16LE(offset) !== 0;
      case 0x0014: return buffer.readBigInt64LE(offset);
      case 0x0040: {
        const fileTime = buffer.readBigUInt64LE(offset);
        return new Date(Number(fileTime / 10_000n - 11_644_473_600_000n));
      }
      default: return undefined;
    }
  }
}
