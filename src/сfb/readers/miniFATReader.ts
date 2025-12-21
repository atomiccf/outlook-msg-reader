import { Readable } from 'stream';
import { HeaderInfo } from "../../types";
import { container } from '../../di/container';
import { FATReader } from './fatReader';
import { parseUint32Array } from "../../utils/utils";
import { CFBFConstants } from "../../constants/cfbf";

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
    async buildMiniFAT(input: string | Readable, headerInfo: HeaderInfo) {
        this.miniFAT = [];

        let sector:number | null = headerInfo.miniFatStartSector;
        let remaining = headerInfo.miniFatSectorCount;
        const visited = new Set<number>();

        if (
            sector === null ||
            sector === undefined ||
            sector === this.cfbConstants.END_OF_CHAIN ||
            sector === this.cfbConstants.FREE_SECTOR
        ) {
            return;
        }

        while (sector !== null && remaining-- > 0) {
            if (visited.has(sector)) {
                throw new Error('MiniFAT sector chain loop detected');
            }
            visited.add(sector);

            const sectorBytes = await this.fatReader.readSector(input, sector, headerInfo);
            if (!sectorBytes || sectorBytes.length === 0) break;

            this.miniFAT.push(...parseUint32Array(sectorBytes));

            const next = this.fatReader.getNextSector(sector);

            if (
                next === this.cfbConstants.END_OF_CHAIN ||
                next === this.cfbConstants.FREE_SECTOR ||
                next === this.cfbConstants.FAT_SECTOR ||
                next === this.cfbConstants.DIFAT_SECTOR
            ) {
                break;
            }

            sector = next;
        }
    }

    /**
     * Returns the next mini-sector index for the given mini-sector index.
     * Returns null on END_OF_CHAIN or if index is out of range or entry is FREE_SECTOR.
     *
     * Note: index must be a non-negative integer.
     */
    getNextMiniSector(index: number): number | null {
        if (!Number.isInteger(index) || index < 0) return null;

        // If index is beyond what we've read — return null (defensive)
        if (index >= this.miniFAT.length) return null;

        const next = this.miniFAT[index];

        if (next === this.cfbConstants.END_OF_CHAIN) return null;
        if (next === this.cfbConstants.FREE_SECTOR) return null;

        // If next is out-of-range (corrupted), return null
        if (!Number.isInteger(next) || next < 0) return null;

        return next;
    }
}

export function MiniFATReaderFactory(): MiniFATReader {
    const fatReader = container.get<FATReader>('fatReader');
    const cfbConstants = container.get<CFBFConstants>('cfbfConstants');
    return new MiniFATReader(fatReader,cfbConstants);
}
