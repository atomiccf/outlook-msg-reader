import { MiniFATReader } from './miniFATReader';
import type { Resolver } from '../../di/service-locator';
import { TOKENS } from '../../di/tokens';
import { CorruptedSectorChainError } from '../../errors/errors';


/**
 * MiniStreamReader reads small streams from the MiniStream using MiniFAT
 */
export class MiniStreamReader {
    private miniFATReader: MiniFATReader;
    private miniStreamBuffer: Buffer = Buffer.alloc(0);
    private miniSectorSize: number;

    constructor(miniFATReader: MiniFATReader) {
        this.miniFATReader = miniFATReader;
        this.miniSectorSize = 1 << 6; // default 64 bytes, can read from header if needed
    }

    /**
     * Loads the entire mini-stream from the root storage stream
     * @param rootStreamBuffer - buffer of the root entry that contains mini-stream
     * @param miniSectorSize
     */
    async loadMiniStream(rootStreamBuffer: Buffer, miniSectorSize: number): Promise<void> {
        // The mini-stream is stored as a normal stream in FAT
        // Here we just assign it to buffer, it could also be read from input via FATReader
        this.miniStreamBuffer = rootStreamBuffer;
        this.miniSectorSize = miniSectorSize;
    }

    /**
     * Reads a mini-stream entry using MiniFAT
     * @param entry - DirectoryEntry with startingSectorLocation and streamSize
     */

    readMiniStream(entry: { startingSectorLocation: number, streamSize: number }): Buffer {
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

            const offset = sector * this.miniSectorSize;
            const required = Math.min(this.miniSectorSize, streamSize - filled);

            if (!Number.isSafeInteger(offset) || offset < 0 || offset + required > this.miniStreamBuffer.length) {
                throw new CorruptedSectorChainError(
                    `Mini stream sector ${sector} exceeds the root mini stream bounds`
                );
            }

            this.miniStreamBuffer.copy(
                out,
                filled,
                offset,
                offset + required
            );

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
}


export function MiniStreamReaderFactory(resolver: Resolver): MiniStreamReader {
    const miniFAT = resolver.get(TOKENS.miniFATReader);
    return new MiniStreamReader(miniFAT);
}
