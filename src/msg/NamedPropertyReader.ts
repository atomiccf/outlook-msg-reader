import type { CFBFReader } from '../сfb/CFBReader';
import type { Decoder } from '../encoding/decoder';
import type { CodePageReader } from './CodePageReader';
import { NamedPropertyKind, type NamedPropertyMapping, type NamedPropertyEntry } from '../constants/types';

/**
 * Reader for named properties in MSG files.
 * Parses the __nameid_version1.0 stream to map GUID+name combinations to property IDs.
 */
export class NamedPropertyReader {
    private mappingCache: Map<string, NamedPropertyMapping> = new Map();
    private guids: string[] = [];
    private names: (string | number)[] = [];
    private entries: NamedPropertyEntry[] = [];
    private initialized = false;

    constructor(
        private readonly cfbReader: CFBFReader,
        private readonly decoder: Decoder,
        private readonly codePageReader: CodePageReader
    ) {}

    /**
     * Initializes the named property mapping by reading __nameid_version1.0 stream.
     * Must be called before using other methods.
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            const nameidStream = await this.cfbReader.readStream(['Root Entry', '__nameid_version1.0']);
            if (!nameidStream || nameidStream.length < 8) {
                // No named properties stream found
                this.initialized = true;
                return;
            }

            await this.parseNameidStream(nameidStream);
            this.initialized = true;
        } catch (error) {
            // Stream might not exist if there are no named properties
            this.initialized = true;
        }
    }

    /**
     * Parses the __nameid_version1.0 stream structure.
     * Format:
     * - Header: 8 bytes (version: 4 bytes, count: 4 bytes)
     * - GUID entries: 16 bytes each
     * - String entries: variable length
     * - Hash table entries: 8 bytes each (property ID + index)
     */
    private async parseNameidStream(buffer: Buffer): Promise<void> {
        let offset = 0;

        // Read header
        const version = buffer.readUInt32LE(offset);
        offset += 4;
        const entryCount = buffer.readUInt32LE(offset);
        offset += 4;

        if (version !== 1) {
            console.warn(`[NamedPropertyReader] Unsupported nameid version: ${version}`);
            return;
        }

        // Read GUID entries (first GUID is always PS_PUBLIC_STRINGS)
        const guidCount = buffer.readUInt32LE(offset);
        offset += 4;
        
        for (let i = 0; i < guidCount; i++) {
            if (offset + 16 > buffer.length) break;
            const guidBytes = buffer.subarray(offset, offset + 16);
            const guid = this.formatGUID(guidBytes);
            this.guids.push(guid);
            offset += 16;
        }

        // Read string entries
        const stringCount = buffer.readUInt32LE(offset);
        offset += 4;

        const codepage = await this.codePageReader.getCodepage();

        for (let i = 0; i < stringCount; i++) {
            if (offset + 4 > buffer.length) break;
            
            const length = buffer.readUInt32LE(offset);
            offset += 4;

            if (length === 0) {
                // Numeric ID instead of string
                if (offset + 4 > buffer.length) break;
                const numericId = buffer.readUInt32LE(offset);
                offset += 4;
                this.names.push(numericId);
            } else {
                // String name
                if (offset + length > buffer.length) break;
                const nameBytes = buffer.subarray(offset, offset + length);
                offset += length;
                
                // Try UTF-16 first, then codepage
                let name: string;
                try {
                    name = nameBytes.toString('utf16le').replace(/\u0000+$/g, '');
                } catch {
                    name = this.decoder.decodeBytes(nameBytes, codepage);
                }
                this.names.push(name);
            }
        }

        // Read hash table entries
        for (let i = 0; i < entryCount; i++) {
            if (offset + 8 > buffer.length) break;

            const propertyId = buffer.readUInt16LE(offset);
            offset += 2;
            const index = buffer.readUInt16LE(offset);
            offset += 2;
            const guidIndex = buffer.readUInt16LE(offset);
            offset += 2;
            const flags = buffer.readUInt16LE(offset);
            offset += 2;

            const kind = (flags & 0x0001) === 0 ? NamedPropertyKind.NUMERIC : NamedPropertyKind.STRING;
            const nameIndex = index;

            this.entries.push({
                propertyId,
                guidIndex,
                nameIndex,
                kind
            });
        }

        // Build mapping cache
        this.buildMappingCache();
    }

    /**
     * Formats GUID bytes to string format: {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}
     */
    private formatGUID(guidBytes: Buffer): string {
        const parts = [
            guidBytes.readUInt32LE(0).toString(16).padStart(8, '0'),
            guidBytes.readUInt16LE(4).toString(16).padStart(4, '0'),
            guidBytes.readUInt16LE(6).toString(16).padStart(4, '0'),
            guidBytes.subarray(8, 10).toString('hex'),
            guidBytes.subarray(10, 16).toString('hex')
        ];
        return `{${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}-${parts[4]}}`;
    }

    /**
     * Builds the mapping cache for quick lookups.
     */
    private buildMappingCache(): void {
        for (const entry of this.entries) {
            if (entry.guidIndex >= this.guids.length) continue;
            if (entry.nameIndex >= this.names.length) continue;

            const guid = this.guids[entry.guidIndex];
            const nameOrId = this.names[entry.nameIndex];

            const key = entry.kind === NamedPropertyKind.STRING
                ? `${guid}:${nameOrId}`
                : `${guid}:${nameOrId}`;

            const mapping: NamedPropertyMapping = {
                guid,
                propertyId: entry.propertyId,
                ...(entry.kind === NamedPropertyKind.STRING
                    ? { name: nameOrId as string }
                    : { numericId: nameOrId as number })
            };

            this.mappingCache.set(key, mapping);
        }
    }

    /**
     * Gets property ID by GUID and name.
     * 
     * @param guid - Property set GUID (e.g., PS_PUBLIC_STRINGS)
     * @param name - Property name (string) or numeric ID
     * @returns Property ID (0x8000-0xFFFF) or undefined if not found
     */
    getPropertyId(guid: string, name: string | number): number | undefined {
        const key = `${guid}:${name}`;
        return this.mappingCache.get(key)?.propertyId;
    }

    /**
     * Gets all mappings for a specific GUID.
     * 
     * @param guid - Property set GUID
     * @returns Array of mappings
     */
    getMappingsByGuid(guid: string): NamedPropertyMapping[] {
        return Array.from(this.mappingCache.values())
            .filter(m => m.guid === guid);
    }

    /**
     * Gets mapping by property ID.
     * 
     * @param propertyId - Property ID (0x8000-0xFFFF)
     * @returns Mapping or undefined if not found
     */
    getMappingByPropertyId(propertyId: number): NamedPropertyMapping | undefined {
        return Array.from(this.mappingCache.values())
            .find(m => m.propertyId === propertyId);
    }

    /**
     * Checks if named properties are available.
     */
    hasNamedProperties(): boolean {
        return this.mappingCache.size > 0;
    }
}

/**
 * Factory function to create NamedPropertyReader
 */
export function createNamedPropertyReader(
    cfbReader: CFBFReader,
    decoder: Decoder,
    codePageReader: CodePageReader
): NamedPropertyReader {
    return new NamedPropertyReader(cfbReader, decoder, codePageReader);
}



