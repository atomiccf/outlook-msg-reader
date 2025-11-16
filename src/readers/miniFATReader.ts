import { Readable } from 'stream';
import { HeaderInfo } from "../types";
import { container } from '../di/container';
import { FATReader } from './fatReader';
import { CFBFConstants } from "../constants/cfbf";
import { parseUint32Array } from "../utils/utils";

export class MiniFATReader {
    private miniFAT: number[] = [];
    constructor(constants:CFBFConstants, fatReader:FATReader) {
        this.constants = constants;
        this.fatReader = fatReader;
    }
    private constants = container.resolve<any>('CFBFConstants');
    private fatReader = container.resolve<FATReader>('fatReaderFactory');


    /**
     * Loads all MiniFAT sectors from the file
     */
    async buildMiniFAT(input: string | Readable, headerInfo: HeaderInfo) {
        let sector = headerInfo.miniFatStartSector;
        const visited = new Set<number>();

        while (sector !== this.constants.END_OF_CHAIN) {
            if (visited.has(sector)) {
                throw new Error('MiniFAT sector chain loop detected');
            }
            visited.add(sector);

            const sectorBytes = await this.fatReader.readSector(input, sector, headerInfo);

            const entries = parseUint32Array(sectorBytes);
            this.miniFAT.push(...entries);

            sector = this.fatReader.getNextSector(sector)!;
        }
    }

    /**
     * Returns the next mini-sector in the chain or null (END_OF_CHAIN)
     */
    getNextMiniSector(index: number): number | null {
        if (index < 0 || index >= this.miniFAT.length) return null;
        const next = this.miniFAT[index];
        return next === this.constants.END_OF_CHAIN ? null : next;
    }

    /**
     * Returns the length of the loaded MiniFAT table
     */
    getLength(): number {
        return this.miniFAT.length;
    }
}

export function MiniFATReaderFactory(): MiniFATReader {
    const constants = container.resolve<CFBFConstants>(CFBFConstants);
    const fatReader = container.resolve<FATReader>('fatReaderFactory');
    return new MiniFATReader(constants, fatReader);
}
