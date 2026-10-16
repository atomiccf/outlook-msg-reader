import type { CFBFReader } from '../cfb/CFBReader';
import type { NamedPropertyMapping } from '../constants/types';
import { PropertyDecodeError } from '../errors/errors';
import type { Logger } from '../logging/Logger';

const NAMEID_STORAGE = ['Root Entry', '__nameid_version1.0'];
const GUID_STREAM = '__substg1.0_00020102';
const ENTRY_STREAM = '__substg1.0_00030102';
const STRING_STREAM = '__substg1.0_00040102';
const PS_MAPI = '{00020328-0000-0000-C000-000000000046}';
const PS_PUBLIC_STRINGS = '{00020329-0000-0000-C000-000000000046}';

/** Maps MSG named property GUID/name pairs to their assigned property IDs. */
export class NamedPropertyReader {
  private readonly mappingCache = new Map<string, NamedPropertyMapping>();
  private initialized = false;
  private initialization?: Promise<void>;

  constructor(
    private readonly cfbReader: CFBFReader,
    private readonly logger: Logger,
  ) {}

  initialize(): Promise<void> {
    return this.initialization ??= this.initializeOnce();
  }

  private async initializeOnce(): Promise<void> {
    if (this.initialized) return;

    try {
      const entryStream = await this.cfbReader.readStream([...NAMEID_STORAGE, ENTRY_STREAM]);
      if (!entryStream?.length) {
        this.logger.debug('[NamedPropertyReader] no named properties found');
        this.initialized = true;
        return;
      }

      const [guidStream, stringStream] = await Promise.all([
        this.cfbReader.readStream([...NAMEID_STORAGE, GUID_STREAM]),
        this.cfbReader.readStream([...NAMEID_STORAGE, STRING_STREAM]),
      ]);
      this.parseStreams(guidStream ?? Buffer.alloc(0), entryStream, stringStream ?? Buffer.alloc(0));
      this.logger.debug('[NamedPropertyReader] parsed named properties', {
        mappings: this.mappingCache.size,
      });
      this.initialized = true;
    } catch (error) {
      this.logger.warn('[NamedPropertyReader] initialization failed', error);
      throw new PropertyDecodeError('Unable to initialize named properties', error);
    }
  }

  private parseStreams(guidStream: Buffer, entryStream: Buffer, stringStream: Buffer): void {
    if (guidStream.length % 16 !== 0) {
      throw new PropertyDecodeError('Named property GUID stream length is not a multiple of 16');
    }
    if (entryStream.length % 8 !== 0) {
      throw new PropertyDecodeError('Named property entry stream length is not a multiple of 8');
    }

    for (let offset = 0; offset < entryStream.length; offset += 8) {
      const nameIdentifierOrStringOffset = entryStream.readUInt32LE(offset);
      const indexAndKind = entryStream.readUInt32LE(offset + 4);
      const propertyIndex = indexAndKind & 0xffff;
      const guidIndex = (indexAndKind >>> 16) & 0x7fff;
      const stringKind = (indexAndKind & 0x80000000) !== 0;
      const guid = this.readGuid(guidStream, guidIndex);
      const propertyId = 0x8000 + propertyIndex;

      const mapping: NamedPropertyMapping = stringKind
        ? {
            guid,
            propertyId,
            name: this.readStringName(stringStream, nameIdentifierOrStringOffset),
          }
        : {
            guid,
            propertyId,
            numericId: nameIdentifierOrStringOffset,
          };
      const name = mapping.name ?? mapping.numericId!;
      this.mappingCache.set(this.mappingKey(guid, name), mapping);
    }
  }

  private readGuid(guidStream: Buffer, guidIndex: number): string {
    if (guidIndex === 1) return PS_MAPI;
    if (guidIndex === 2) return PS_PUBLIC_STRINGS;
    if (guidIndex < 3) {
      throw new PropertyDecodeError(`Invalid named property GUID index: ${guidIndex}`);
    }

    const offset = (guidIndex - 3) * 16;
    if (offset + 16 > guidStream.length) {
      throw new PropertyDecodeError(`Named property GUID index ${guidIndex} is out of range`);
    }
    return this.formatGuid(guidStream.subarray(offset, offset + 16));
  }

  private readStringName(stringStream: Buffer, offset: number): string {
    if (offset > stringStream.length - 4) {
      throw new PropertyDecodeError(`Named property string offset ${offset} is out of range`);
    }
    const length = stringStream.readUInt32LE(offset);
    if (length % 2 !== 0 || length > stringStream.length - offset - 4) {
      throw new PropertyDecodeError(`Invalid named property string length ${length} at offset ${offset}`);
    }
    return stringStream.subarray(offset + 4, offset + 4 + length).toString('utf16le');
  }

  private formatGuid(guidBytes: Buffer): string {
    const parts = [
      guidBytes.readUInt32LE(0).toString(16).padStart(8, '0'),
      guidBytes.readUInt16LE(4).toString(16).padStart(4, '0'),
      guidBytes.readUInt16LE(6).toString(16).padStart(4, '0'),
      guidBytes.subarray(8, 10).toString('hex'),
      guidBytes.subarray(10, 16).toString('hex'),
    ];
    return `{${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}-${parts[4]}}`.toUpperCase();
  }

  private mappingKey(guid: string, name: string | number): string {
    return `${guid.toUpperCase()}:${name}`;
  }

  getPropertyId(guid: string, name: string | number): number | undefined {
    return this.mappingCache.get(this.mappingKey(guid, name))?.propertyId;
  }

  getMappingsByGuid(guid: string): NamedPropertyMapping[] {
    const normalizedGuid = guid.toUpperCase();
    return Array.from(this.mappingCache.values())
      .filter((mapping) => mapping.guid.toUpperCase() === normalizedGuid);
  }

  getMappingByPropertyId(propertyId: number): NamedPropertyMapping | undefined {
    return Array.from(this.mappingCache.values())
      .find((mapping) => mapping.propertyId === propertyId);
  }

  hasNamedProperties(): boolean {
    return this.mappingCache.size > 0;
  }
}

export function createNamedPropertyReader(
  cfbReader: CFBFReader,
  logger: Logger,
): NamedPropertyReader {
  return new NamedPropertyReader(cfbReader, logger);
}
