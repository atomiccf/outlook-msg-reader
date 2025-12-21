import { container } from '../../di/container';
import { MiniFATReader } from './miniFATReader';


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

        while (sector !== null && filled < streamSize) {
            const offset = sector * this.miniSectorSize;

            // Check bounds to prevent reading beyond buffer
            if (offset >= this.miniStreamBuffer.length) {
                break;
            }

            const available = Math.min(
                this.miniSectorSize,
                streamSize - filled,
                this.miniStreamBuffer.length - offset
            );

            this.miniStreamBuffer.copy(
                out,
                filled,
                offset,
                offset + available
            );

            filled += available;

            sector = this.miniFATReader.getNextMiniSector(sector);
        }

        return out;
    }
    // readMiniStream(entry: { startingSectorLocation: number, streamSize: number }): Buffer {
    //     console.log(`[readMiniStream] Reading entry:`, entry);
    //     console.log(`[readMiniStream] miniStreamBuffer size: ${this.miniStreamBuffer.length}, miniSectorSize: ${this.miniSectorSize}`);
    //     const result = Buffer.alloc(entry.streamSize);
    //     let miniSector: number | null = entry.startingSectorLocation;
    //     let offset = 0;
    //
    //     while (miniSector !== null) {
    //         const srcOffset = miniSector * this.miniSectorSize;
    //         const slice = this.miniStreamBuffer.subarray(srcOffset, srcOffset + this.miniSectorSize);
    //
    //         slice.copy(result, offset);
    //         offset += slice.length;
    //
    //         miniSector = this.miniFATReader.getNextMiniSector(miniSector);
    //     }
    //     return result.subarray(0, entry.streamSize);
    // }
}


export function MiniStreamReaderFactory(): MiniStreamReader {
    const miniFAT = container.get<MiniFATReader>('miniFATReader');
    return new MiniStreamReader(miniFAT);
}
