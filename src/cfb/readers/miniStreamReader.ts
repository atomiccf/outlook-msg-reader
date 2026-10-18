import { MiniFATReader } from './miniFATReader';
import { FATReader } from './fatReader';
import type { Resolver } from '../../di/service-locator';
import { TOKENS } from '../../di/tokens';
import { CorruptedSectorChainError } from '../../errors/errors';
import type { HeaderInfo } from '../../types';
import type { RandomAccessInput } from '../InputSource';


/**
 * MiniStreamReader reads small streams from the MiniStream using MiniFAT
 */
export class MiniStreamReader {
    private input?: RandomAccessInput;
    private headerInfo?: HeaderInfo;
    private rootStartSector?: number;
    private rootStreamSize = 0;
    private readonly rootSectors: number[] = [];
    private readonly visitedRootSectors = new Set<number>();
    private cachedSector?: { index: number; data: Buffer };

    constructor(
        private readonly miniFATReader: MiniFATReader,
        private readonly fatReader: FATReader,
    ) {}

    /**
     * Configures random access to the root mini-stream without materializing it.
     */
    async loadMiniStream(
        input: RandomAccessInput,
        headerInfo: HeaderInfo,
        root: { startingSectorLocation: number; streamSize: number },
    ): Promise<void> {
        this.input = input;
        this.headerInfo = headerInfo;
        this.rootStartSector = root.startingSectorLocation;
        this.rootStreamSize = root.streamSize;
        this.rootSectors.length = 0;
        this.visitedRootSectors.clear();
        if (root.streamSize > 0) {
            this.rootSectors.push(root.startingSectorLocation);
            this.visitedRootSectors.add(root.startingSectorLocation);
        }
        this.cachedSector = undefined;
    }

    /**
     * Reads a mini-stream entry using MiniFAT
     * @param entry - DirectoryEntry with startingSectorLocation and streamSize
     */

    async readMiniStream(entry: { startingSectorLocation: number, streamSize: number }): Promise<Buffer> {
        const { startingSectorLocation, streamSize } = entry;

        const out = Buffer.alloc(streamSize);
        let filled = 0;
        let sector: number | null = startingSectorLocation;
        const visited = new Set<number>();

        while (sector !== null && filled < streamSize) {
            if (visited.has(sector)) {
                throw new CorruptedSectorChainError('MiniFAT sector chain loop detected');
            }
            visited.add(sector);

            const miniSectorSize = this.headerInfo?.miniSectorSize;
            if (!miniSectorSize) throw new Error('MiniStreamReader is not initialized');
            const offset = sector * miniSectorSize;
            const required = Math.min(miniSectorSize, streamSize - filled);

            if (!Number.isSafeInteger(offset) || offset < 0 || offset + required > this.rootStreamSize) {
                throw new CorruptedSectorChainError(
                    `Mini stream sector ${sector} exceeds the root mini stream bounds`
                );
            }

            const data = await this.readRootRange(offset, required);
            data.copy(out, filled);

            filled += required;
            if (filled < streamSize) {
                sector = this.miniFATReader.getNextMiniSector(sector);
                if (sector === null) {
                    throw new CorruptedSectorChainError(
                        `MiniFAT chain ended after ${filled} bytes; expected ${streamSize}`
                    );
                }
            }
        }

        return out;
    }

    private async readRootRange(offset: number, length: number): Promise<Buffer> {
        if (!this.input || !this.headerInfo || this.rootStartSector === undefined) {
            throw new Error('MiniStreamReader is not initialized');
        }
        const sectorOrdinal = Math.floor(offset / this.headerInfo.sectorSize);
        const sectorOffset = offset % this.headerInfo.sectorSize;
        const sectorIndex = this.getRootSector(sectorOrdinal);
        if (!this.cachedSector || this.cachedSector.index !== sectorIndex) {
            this.cachedSector = {
                index: sectorIndex,
                data: await this.fatReader.readSector(this.input, sectorIndex, this.headerInfo),
            };
        }
        return this.cachedSector.data.subarray(sectorOffset, sectorOffset + length);
    }

    private getRootSector(ordinal: number): number {
        while (this.rootSectors.length <= ordinal) {
            const previous = this.rootSectors[this.rootSectors.length - 1];
            const next = this.fatReader.getNextSector(previous);
            if (next === null) {
                throw new CorruptedSectorChainError('Root mini stream FAT chain ended unexpectedly');
            }
            if (this.visitedRootSectors.has(next)) {
                throw new CorruptedSectorChainError('Root mini stream FAT chain loop detected');
            }
            this.rootSectors.push(next);
            this.visitedRootSectors.add(next);
        }
        return this.rootSectors[ordinal];
    }
}


export function MiniStreamReaderFactory(resolver: Resolver): MiniStreamReader {
    const miniFAT = resolver.get(TOKENS.miniFATReader);
    const fatReader = resolver.get(TOKENS.fatReader);
    return new MiniStreamReader(miniFAT, fatReader);
}
