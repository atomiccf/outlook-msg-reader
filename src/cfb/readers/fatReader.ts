import { HeaderInfo } from "../../types";
import { parseUint32Array } from "../../utils/utils";
import { CorruptedSectorChainError } from '../../errors/errors';
import { readAt, type RandomAccessInput } from '../InputSource';
import { END_OF_CHAIN, FREE_SECTOR, MAX_REGULAR_SECTOR } from '../../constants/cfbf';

export class FATReader {
    private fatTable: Record<number, number> = {};
    private fatEntryCount = 0;

    reset(): void {
        this.fatTable = {};
        this.fatEntryCount = 0;
    }

    async buildTable(input: RandomAccessInput, headerInfo: HeaderInfo) {
        this.reset();
        const fatSectorLocations = await this.readFatSectorLocations(input, headerInfo);
        headerInfo.fatSectorLocations = fatSectorLocations;

        for (let fatSectorOrdinal = 0; fatSectorOrdinal < fatSectorLocations.length; fatSectorOrdinal++) {
            const sectorIndex = fatSectorLocations[fatSectorOrdinal];
            const sectorBytes = await this.readSector(input, sectorIndex, headerInfo);
            const entries = parseUint32Array(sectorBytes);

            for (let i = 0; i < entries.length; i++) {
                // A FAT sector describes a consecutive range of sectors according
                // to its position in DIFAT. Its own physical sector number only
                // tells us where to read the FAT sector from.
                const actualIndex = fatSectorOrdinal * entries.length + i;
                this.fatTable[actualIndex] = entries[i];
            }
            this.fatEntryCount += entries.length;
        }

        return this.fatTable;
    }

    private async readFatSectorLocations(input: RandomAccessInput, headerInfo: HeaderInfo): Promise<number[]> {
        const locations = [...headerInfo.fatSectorLocations];
        const expectedCount = headerInfo.numFATSectors;
        const difatSectorCount = headerInfo.numDIFATSectors ?? 0;
        let difatSector = headerInfo.difatStartSector ?? END_OF_CHAIN;

        for (const sector of locations) {
            this.assertRegularSector(sector, 'FAT sector');
        }

        if (difatSectorCount === 0) {
            if (difatSector !== END_OF_CHAIN) {
                throw new CorruptedSectorChainError(
                    `DIFAT start sector is ${difatSector}, but the header declares no DIFAT sectors`
                );
            }
        } else if (difatSector === END_OF_CHAIN) {
            throw new CorruptedSectorChainError('DIFAT chain is missing its first sector');
        }

        const visited = new Set<number>();
        const entriesPerDifatSector = headerInfo.sectorSize / 4 - 1;

        for (let ordinal = 0; ordinal < difatSectorCount; ordinal++) {
            this.assertRegularSector(difatSector, 'DIFAT sector');
            if (visited.has(difatSector)) {
                throw new CorruptedSectorChainError('DIFAT sector chain loop detected');
            }
            visited.add(difatSector);

            const bytes = await this.readSector(input, difatSector, headerInfo);
            for (let i = 0; i < entriesPerDifatSector; i++) {
                const fatSector = bytes.readUInt32LE(i * 4);
                if (fatSector === FREE_SECTOR) continue;
                this.assertRegularSector(fatSector, 'FAT sector');
                locations.push(fatSector);
            }

            const next = bytes.readUInt32LE(headerInfo.sectorSize - 4);
            const isLast = ordinal === difatSectorCount - 1;
            if (isLast && next !== END_OF_CHAIN) {
                throw new CorruptedSectorChainError('DIFAT sector chain does not terminate at the declared length');
            }
            if (!isLast && next === END_OF_CHAIN) {
                throw new CorruptedSectorChainError('DIFAT sector chain ended before the declared length');
            }
            difatSector = next;
        }

        if (locations.length !== expectedCount) {
            throw new CorruptedSectorChainError(
                `FAT sector count mismatch: expected ${expectedCount}, found ${locations.length}`
            );
        }

        if (new Set(locations).size !== locations.length) {
            throw new CorruptedSectorChainError('DIFAT contains duplicate FAT sector locations');
        }

        return locations;
    }

    private assertRegularSector(sector: number, label: string): void {
        if (!Number.isInteger(sector) || sector < 0 || sector > MAX_REGULAR_SECTOR) {
            throw new CorruptedSectorChainError(`Invalid ${label} index: ${sector}`);
        }
    }

    async readSector(input: RandomAccessInput, sectorIndex: number, headerInfo: HeaderInfo): Promise<Buffer> {
        this.assertRegularSector(sectorIndex, 'sector');
        const offset = (sectorIndex + 1) * headerInfo.sectorSize;

        const result = await readAt(input, offset, headerInfo.sectorSize);

        if (result.length !== headerInfo.sectorSize) {
            throw new CorruptedSectorChainError(
                `Sector ${sectorIndex} is truncated: expected ${headerInfo.sectorSize} bytes, found ${result.length}`
            );
        }

        return result;
    }

    getNextSector(sectorIndex: number): number | null {
        const next = this.fatTable[sectorIndex];
        if (next === undefined) {
            throw new CorruptedSectorChainError(`FAT entry is missing for sector ${sectorIndex}`);
        }
        if (next === END_OF_CHAIN) return null;
        if (next === FREE_SECTOR) {
            throw new CorruptedSectorChainError(`FAT chain points to a free sector after sector ${sectorIndex}`);
        }
        if (next > MAX_REGULAR_SECTOR) {
            throw new CorruptedSectorChainError(
                `FAT chain contains invalid marker 0x${next.toString(16).toUpperCase()} after sector ${sectorIndex}`
            );
        }
        return next;
    }

    /**
     * Reads a whole sector chain starting at startSector (following FAT) and
     * returns a concatenated buffer of all sectors in the chain.
     * Requires buildTable() to be called beforehand.
     */
    async readChain(
        input: RandomAccessInput,
        startSector: number,
        headerInfo: HeaderInfo,
        expectedSize?: number,
        maxBytes?: number,
    ): Promise<Buffer> {
        const buffers: Buffer[] = [];
        for await (const chunk of this.readChainChunks(input, startSector, headerInfo, expectedSize, maxBytes)) {
            buffers.push(chunk);
        }
        return Buffer.concat(buffers);
    }

    /** Reads a FAT chain one sector at a time without concatenating it in memory. */
    async *readChainChunks(
        input: RandomAccessInput,
        startSector: number,
        headerInfo: HeaderInfo,
        expectedSize?: number,
        maxBytes?: number,
    ): AsyncGenerator<Buffer> {
        if (this.fatEntryCount === 0) {
            throw new CorruptedSectorChainError('FAT table is empty');
        }
        this.assertRegularSector(startSector, 'chain start sector');

        if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) {
            throw new CorruptedSectorChainError(`Invalid expected stream size: ${expectedSize}`);
        }
        if (maxBytes !== undefined && expectedSize !== undefined && expectedSize > maxBytes) {
            throw new RangeError(`CFBF chain exceeds maximum buffered bytes (${maxBytes})`);
        }
        if (expectedSize === 0) return;

        const visited = new Set<number>();
        const expectedSectors = expectedSize === undefined
            ? undefined
            : Math.ceil(expectedSize / headerInfo.sectorSize);
        let sectorsRead = 0;
        let bytesRead = 0;
        let remaining = expectedSize;

        let sector: number | null = startSector;
        while (sector !== null) {
            if (visited.has(sector)) {
                throw new CorruptedSectorChainError('FAT sector chain loop detected');
            }
            visited.add(sector);

            const nextChunkBytes = Math.min(headerInfo.sectorSize, remaining ?? headerInfo.sectorSize);
            if (maxBytes !== undefined && nextChunkBytes > maxBytes - bytesRead) {
                throw new RangeError(`CFBF chain exceeds maximum buffered bytes (${maxBytes})`);
            }
            const bytes = await this.readSector(input, sector, headerInfo);
            sectorsRead += 1;
            const chunk = remaining === undefined ? bytes : bytes.subarray(0, Math.min(bytes.length, remaining));
            bytesRead += chunk.length;
            if (chunk.length > 0) yield chunk;
            if (remaining !== undefined) remaining -= chunk.length;

            const next = this.getNextSector(sector);
            if (expectedSectors !== undefined && sectorsRead === expectedSectors) {
                if (next !== null) {
                    throw new CorruptedSectorChainError(
                        `FAT chain continues after ${sectorsRead} sectors; expected ${expectedSectors}`
                    );
                }
                sector = null;
                continue;
            }
            if (expectedSectors !== undefined && next === null) {
                throw new CorruptedSectorChainError(
                    `FAT chain ended after ${sectorsRead} sectors; expected ${expectedSectors}`
                );
            }
            sector = next;
        }
    }
}

export function FATReaderFactory(): FATReader {
    return new FATReader();
}
