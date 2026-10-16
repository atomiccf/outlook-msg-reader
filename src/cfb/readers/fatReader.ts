import { HeaderInfo } from "../../types";
import type * as fs from 'node:fs';
import { parseUint32Array } from "../../utils/utils";
import type { Resolver } from '../../di/service-locator';
import { TOKENS } from '../../di/tokens';
import { CorruptedSectorChainError } from '../../errors/errors';
import { readAt, type RandomAccessInput } from '../InputSource';
import { CFBFConstants } from '../../constants/cfbf';

export class FATReader {
    private fatTable: Record<number, number> = {};
    private readonly constants: CFBFConstants;

    constructor(constants?: CFBFConstants);
    constructor(_legacyFs: typeof fs, constants?: CFBFConstants);
    constructor(
        constantsOrLegacyFs: CFBFConstants | typeof fs = new CFBFConstants(),
        legacyConstants?: CFBFConstants,
    ){
        this.constants = legacyConstants ?? (
            constantsOrLegacyFs instanceof CFBFConstants
                ? constantsOrLegacyFs
                : new CFBFConstants()
        );
    }

    async buildTable(input: RandomAccessInput, headerInfo: HeaderInfo) {
        this.fatTable = {};
        const fatSectorLocations = await this.#readFatSectorLocations(input, headerInfo);
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
        }

        return this.fatTable;
    }

    async #readFatSectorLocations(input: RandomAccessInput, headerInfo: HeaderInfo): Promise<number[]> {
        const locations = [...headerInfo.fatSectorLocations];
        const expectedCount = headerInfo.numFATSectors;
        const difatSectorCount = headerInfo.numDIFATSectors ?? 0;
        let difatSector = headerInfo.difatStartSector ?? this.constants.END_OF_CHAIN;

        for (const sector of locations) {
            this.#assertRegularSector(sector, 'FAT sector');
        }

        if (difatSectorCount === 0) {
            if (difatSector !== this.constants.END_OF_CHAIN) {
                throw new CorruptedSectorChainError(
                    `DIFAT start sector is ${difatSector}, but the header declares no DIFAT sectors`
                );
            }
        } else if (difatSector === this.constants.END_OF_CHAIN) {
            throw new CorruptedSectorChainError('DIFAT chain is missing its first sector');
        }

        const visited = new Set<number>();
        const entriesPerDifatSector = headerInfo.sectorSize / 4 - 1;

        for (let ordinal = 0; ordinal < difatSectorCount; ordinal++) {
            this.#assertRegularSector(difatSector, 'DIFAT sector');
            if (visited.has(difatSector)) {
                throw new CorruptedSectorChainError('DIFAT sector chain loop detected');
            }
            visited.add(difatSector);

            const bytes = await this.readSector(input, difatSector, headerInfo);
            for (let i = 0; i < entriesPerDifatSector; i++) {
                const fatSector = bytes.readUInt32LE(i * 4);
                if (fatSector === this.constants.FREE_SECTOR) continue;
                this.#assertRegularSector(fatSector, 'FAT sector');
                locations.push(fatSector);
            }

            const next = bytes.readUInt32LE(headerInfo.sectorSize - 4);
            const isLast = ordinal === difatSectorCount - 1;
            if (isLast && next !== this.constants.END_OF_CHAIN) {
                throw new CorruptedSectorChainError('DIFAT sector chain does not terminate at the declared length');
            }
            if (!isLast && next === this.constants.END_OF_CHAIN) {
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

    #assertRegularSector(sector: number, label: string): void {
        if (!Number.isInteger(sector) || sector < 0 || sector > this.constants.MAX_REGULAR_SECTOR) {
            throw new CorruptedSectorChainError(`Invalid ${label} index: ${sector}`);
        }
    }

    async readSector(input: RandomAccessInput, sectorIndex: number, headerInfo: HeaderInfo): Promise<Buffer> {
        this.#assertRegularSector(sectorIndex, 'sector');
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
        if (next === this.constants.END_OF_CHAIN) return null;
        if (next === this.constants.FREE_SECTOR) {
            throw new CorruptedSectorChainError(`FAT chain points to a free sector after sector ${sectorIndex}`);
        }
        if (next > this.constants.MAX_REGULAR_SECTOR) {
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
        expectedSize?: number
    ): Promise<Buffer> {
        if (!this.fatTable || Object.keys(this.fatTable).length === 0) {
            throw new CorruptedSectorChainError('FAT table is empty');
        }
        this.#assertRegularSector(startSector, 'chain start sector');

        if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) {
            throw new CorruptedSectorChainError(`Invalid expected stream size: ${expectedSize}`);
        }

        const visited = new Set<number>();
        const buffers: Buffer[] = [];
        const expectedSectors = expectedSize === undefined
            ? undefined
            : Math.ceil(expectedSize / headerInfo.sectorSize);

        let sector: number | null = startSector;
        while (sector !== null) {
            if (visited.has(sector)) {
                throw new CorruptedSectorChainError('FAT sector chain loop detected');
            }
            visited.add(sector);

            const bytes = await this.readSector(input, sector, headerInfo);
            buffers.push(bytes);

            const next = this.getNextSector(sector);
            if (expectedSectors !== undefined && buffers.length === expectedSectors) {
                sector = null;
                continue;
            }
            if (expectedSectors !== undefined && next === null) {
                throw new CorruptedSectorChainError(
                    `FAT chain ended after ${buffers.length} sectors; expected ${expectedSectors}`
                );
            }
            sector = next;
        }

        return Buffer.concat(buffers);
    }
}

export function FATReaderFactory(resolver: Resolver): FATReader {
    const constants = resolver.get(TOKENS.cfbfConstants);
    return new FATReader(constants);
}
