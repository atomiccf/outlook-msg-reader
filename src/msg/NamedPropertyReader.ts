import type { CFBFReader } from '../cfb/CFBReader';
import {
  NamedPropertyKind,
  type NamedPropertyMapping,
  type NamedPropertyEntry,
} from '../constants/types';
import type { Logger } from '../logging/Logger';
import { PropertyDecodeError } from '../errors/errors';
import type { DirectoryNode } from '../types';

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
    private readonly logger: Logger,
  ) {}

  /**
   * Initializes the named property mapping by reading __nameid_version1.0 stream.
   * Must be called before using other methods.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Try reading as stream first (standard MSG files)
      const nameidStream = await this.cfbReader.readStream(['Root Entry', '__nameid_version1.0']);
      this.logger.debug('[NamedPropertyReader] nameid stream', nameidStream?.length ?? 0);

      // If not found as stream, try reading from storage node (Aspose and similar)
      // In Aspose files, __nameid_version1.0 is a storage node containing separate streams
      if (!nameidStream || nameidStream.length < 8) {
        this.logger.debug('[NamedPropertyReader] trying storage-based named properties');

        // Check stream sizes in tree first
        const tree = this.cfbReader.getTree();
        if (tree) {
          // Recursive function to find node by path
          const findNodeByPath = (
            node: DirectoryNode,
            pathParts: string[],
            currentIndex = 0,
          ): DirectoryNode | null => {
            // If we've matched all path parts, return this node
            if (currentIndex >= pathParts.length) return null;

            // Check if current node name matches current path part
            if (node.name !== pathParts[currentIndex]) {
              // Try children
              for (const child of node.children) {
                const found = findNodeByPath(child, pathParts, currentIndex);
                if (found) return found;
              }
              return null;
            }

            // If this is the last part, return this node
            if (currentIndex === pathParts.length - 1) {
              return node;
            }

            // Continue searching in children
            for (const child of node.children) {
              const found = findNodeByPath(child, pathParts, currentIndex + 1);
              if (found) return found;
            }

            return null;
          };

          // Skip 'Root Entry' if tree root is already Root Entry
          const guidPath =
            tree.name === 'Root Entry'
              ? ['__nameid_version1.0', '__substg1.0_00030102']
              : ['Root Entry', '__nameid_version1.0', '__substg1.0_00030102'];
          const entryPath =
            tree.name === 'Root Entry'
              ? ['__nameid_version1.0', '__substg1.0_00020102']
              : ['Root Entry', '__nameid_version1.0', '__substg1.0_00020102'];

          const guidNode = findNodeByPath(tree, guidPath, 0);
          const entryNode = findNodeByPath(tree, entryPath, 0);

          this.logger.debug(
            '[NamedPropertyReader] GUID node in tree',
            guidNode
              ? {
                  name: guidNode.name,
                  type: `0x${guidNode.type?.toString(16)}`,
                  streamSize: guidNode.streamSize,
                  sid: guidNode.sid,
                  startingSector: guidNode.startingSectorLocation,
                }
              : 'not found',
          );

          this.logger.debug(
            '[NamedPropertyReader] Entry node in tree',
            entryNode
              ? {
                  name: entryNode.name,
                  type: `0x${entryNode.type?.toString(16)}`,
                  streamSize: entryNode.streamSize,
                  sid: entryNode.sid,
                  startingSector: entryNode.startingSectorLocation,
                }
              : 'not found',
          );
        }

        // Check if __nameid_version1.0 is a storage node with streams inside
        const guidStreamPath = ['Root Entry', '__nameid_version1.0', '__substg1.0_00030102'];
        const entryStreamPath = ['Root Entry', '__nameid_version1.0', '__substg1.0_00020102'];

        this.logger.debug('[NamedPropertyReader] reading GUID stream', guidStreamPath);
        const guidStream = await this.cfbReader.readStream(guidStreamPath);
        this.logger.debug('[NamedPropertyReader] GUID stream size', guidStream?.length ?? 0);

        this.logger.debug('[NamedPropertyReader] reading entry stream', entryStreamPath);
        const entryStream = await this.cfbReader.readStream(entryStreamPath);
        this.logger.debug('[NamedPropertyReader] entry stream size', entryStream?.length ?? 0);

        if (guidStream && entryStream) {
          this.logger.debug('[NamedPropertyReader] parsing storage-based named properties');
          await this.parseNameidStreamFromSeparateStreams(guidStream, entryStream);
          this.logger.debug('[NamedPropertyReader] parsed named properties', {
            guids: this.guids.length,
            entries: this.entries.length,
            mappings: this.mappingCache.size,
          });
          this.initialized = true;
          return;
        } else {
          this.logger.debug('[NamedPropertyReader] storage-based named properties are incomplete');
        }
      }

      if (!nameidStream || nameidStream.length < 8) {
        // No named properties stream found
        this.logger.debug('[NamedPropertyReader] no named properties found');
        this.initialized = true;
        return;
      }

      this.logger.debug('[NamedPropertyReader] parsing standard named properties');
      await this.parseNameidStream(nameidStream);
      this.logger.debug('[NamedPropertyReader] parsed named properties', {
        guids: this.guids.length,
        entries: this.entries.length,
        mappings: this.mappingCache.size,
      });
      this.initialized = true;
    } catch (error) {
      this.logger.warn('[NamedPropertyReader] initialization failed', error);
      throw new PropertyDecodeError('Unable to initialize named properties', error);
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
      this.logger.warn(`[NamedPropertyReader] Unsupported nameid version: ${version}`);
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

        const name = nameBytes.toString('utf16le').replace(/\u0000+$/g, '');
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
        kind,
      });
    }

    // Build mapping cache
    this.buildMappingCache();
  }

  /**
   * Parses named properties from separate GUID and Entry streams (Aspose format).
   * In Aspose files, __nameid_version1.0 is a storage node containing:
   * - __substg1.0_00030102: GUID stream (contains GUID entries)
   * - __substg1.0_00020102: Entry stream (contains hash table entries)
   */
  private async parseNameidStreamFromSeparateStreams(
    guidStream: Buffer,
    entryStream: Buffer,
  ): Promise<void> {
    this.logger.debug(
      '[NamedPropertyReader] separate stream sizes',
      guidStream.length,
      entryStream.length,
    );

    // Read GUID entries from GUID stream
    // Format: first 4 bytes = count, then 16 bytes per GUID
    let offset = 0;
    if (guidStream.length < 4) {
      this.logger.warn('[NamedPropertyReader] GUID stream too short');
      return;
    }

    const guidCount = guidStream.readUInt32LE(offset);
    this.logger.debug('[NamedPropertyReader] GUID count', guidCount);
    offset += 4;

    for (let i = 0; i < guidCount && offset + 16 <= guidStream.length; i++) {
      const guidBytes = guidStream.subarray(offset, offset + 16);
      const guid = this.formatGUID(guidBytes);
      this.guids.push(guid);
      offset += 16;
    }

    // Read entry stream - this contains hash table entries
    // Format: propertyId (2 bytes), nameIndex (2 bytes), guidIndex (2 bytes), flags (2 bytes)
    // Each entry is 8 bytes
    offset = 0;
    const entryCount = Math.floor(entryStream.length / 8);
    this.logger.debug('[NamedPropertyReader] entry count', entryCount);

    for (let i = 0; i < entryCount && offset + 8 <= entryStream.length; i++) {
      const propertyId = entryStream.readUInt16LE(offset);
      offset += 2;
      const nameIndex = entryStream.readUInt16LE(offset);
      offset += 2;
      const guidIndex = entryStream.readUInt16LE(offset);
      offset += 2;
      const flags = entryStream.readUInt16LE(offset);
      offset += 2;

      const kind = (flags & 0x0001) === 0 ? NamedPropertyKind.NUMERIC : NamedPropertyKind.STRING;

      this.entries.push({
        propertyId,
        guidIndex,
        nameIndex,
        kind,
      });
    }

    this.logger.debug('[NamedPropertyReader] processed entries', {
      total: this.entries.length,
      guidsRead: this.guids.length,
      sampleEntries: this.entries.slice(0, 5).map((e) => ({
        propertyId: `0x${e.propertyId.toString(16)}`,
        guidIndex: e.guidIndex,
        nameIndex: e.nameIndex,
        kind: e.kind === NamedPropertyKind.STRING ? 'STRING' : 'NUMERIC',
      })),
    });

    // Note: String/numeric name entries might need to be read from additional streams
    // For now, we'll build the mapping with what we have
    // If names are needed, they might be in separate streams or embedded differently

    // Build mapping cache (will work with numeric IDs, string names might be missing)
    this.buildMappingCache();
    this.logger.debug('[NamedPropertyReader] mapping cache size', this.mappingCache.size);
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
      guidBytes.subarray(10, 16).toString('hex'),
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

      const key =
        entry.kind === NamedPropertyKind.STRING ? `${guid}:${nameOrId}` : `${guid}:${nameOrId}`;

      const mapping: NamedPropertyMapping = {
        guid,
        propertyId: entry.propertyId,
        ...(entry.kind === NamedPropertyKind.STRING
          ? { name: nameOrId as string }
          : { numericId: nameOrId as number }),
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
    return Array.from(this.mappingCache.values()).filter((m) => m.guid === guid);
  }

  /**
   * Gets mapping by property ID.
   *
   * @param propertyId - Property ID (0x8000-0xFFFF)
   * @returns Mapping or undefined if not found
   */
  getMappingByPropertyId(propertyId: number): NamedPropertyMapping | undefined {
    return Array.from(this.mappingCache.values()).find((m) => m.propertyId === propertyId);
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
  logger: Logger,
): NamedPropertyReader {
  return new NamedPropertyReader(cfbReader, logger);
}
