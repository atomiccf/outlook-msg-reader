import { HeaderInfo } from "../../types";
import { FATReader } from './fatReader';
import { parseUint32Array } from "../../utils/utils";
import { CFBFConstants } from "../../constants/cfbf";
import type { Resolver } from '../../di/service-locator';
import { TOKENS } from '../../di/tokens';
import { CorruptedSectorChainError } from '../../errors/errors';
import type { RandomAccessInput } from '../InputSource';

export class MiniFATReader {
    private miniFAT: number[] = [];
    private readonly fatReader: FATReader;
    private readonly cfbConstants:CFBFConstants;

    constructor( fatReader: FATReader, cfbConstants:CFBFConstants) {
        this.fatReader = fatReader;
        this.cfbConstants = cfbConstants
    }


    /**
     * Builds the miniFAT by reading all sectors from the FAT chain
     * headerInfo.miniFatStartSector must point to the first sector of the miniFAT (or null/undefined if none)
     */
    async buildMiniFAT(input: RandomAccessInput, headerInfo: HeaderInfo) {
        this.miniFAT = [];

        let sector:number | null = headerInfo.miniFatStartSector;
        const sectorCount = headerInfo.miniFatSectorCount;
        const visited = new Set<number>();

        if (sectorCount === 0) {
            if (sector !== this.cfbConstants.END_OF_CHAIN) {
                throw new CorruptedSectorChainError(
                    `MiniFAT start sector is ${sector}, but the header declares no MiniFAT sectors`
                );
            }
            return;
        }
        if (sector === this.cfbConstants.END_OF_CHAIN || sector === this.cfbConstants.FREE_SECTOR) {
            throw new CorruptedSectorChainError('MiniFAT chain is missing its first sector');
        }

        for (let ordinal = 0; ordinal < sectorCount; ordinal++) {
            if (sector === null) {
                throw new CorruptedSectorChainError(
                    `MiniFAT chain ended after ${ordinal} sectors; expected ${sectorCount}`
                );
            }
            if (visited.has(sector)) {
                throw new CorruptedSectorChainError('MiniFAT sector chain loop detected');
            }
            visited.add(sector);

            const sectorBytes = await this.fatReader.readSector(input, sector, headerInfo);
            this.miniFAT.push(...parseUint32Array(sectorBytes));

            const next = this.fatReader.getNextSector(sector);
            const isLast = ordinal === sectorCount - 1;
            if (isLast && next !== null) {
                throw new CorruptedSectorChainError(
                    `MiniFAT chain exceeds the declared ${sectorCount} sectors`
                );
            }
            if (!isLast && next === null) {
                throw new CorruptedSectorChainError(
                    `MiniFAT chain ended after ${ordinal + 1} sectors; expected ${sectorCount}`
                );
            }
            sector = next;
        }
    }

    /**
     * Returns the next mini-sector index for the given mini-sector index.
     * Returns null only on END_OF_CHAIN.
     *
     * Note: index must be a non-negative integer.
     */
    getNextMiniSector(index: number): number | null {
        if (!Number.isInteger(index) || index < 0 || index >= this.miniFAT.length) {
            throw new CorruptedSectorChainError(`Invalid MiniFAT sector index: ${index}`);
        }

        const next = this.miniFAT[index];

        if (next === this.cfbConstants.END_OF_CHAIN) return null;
        if (next === this.cfbConstants.FREE_SECTOR) {
            throw new CorruptedSectorChainError(`MiniFAT chain points to a free sector after sector ${index}`);
        }
        if (!Number.isInteger(next) || next < 0 || next > this.cfbConstants.MAX_REGULAR_SECTOR) {
            throw new CorruptedSectorChainError(
                `MiniFAT chain contains invalid marker 0x${next.toString(16).toUpperCase()} after sector ${index}`
            );
        }

        return next;
    }
}

export function MiniFATReaderFactory(resolver: Resolver): MiniFATReader {
    const fatReader = resolver.get(TOKENS.fatReader);
    const cfbConstants = resolver.get(TOKENS.cfbfConstants);
    return new MiniFATReader(fatReader,cfbConstants);
}
