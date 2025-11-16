import { Readable } from 'stream';
import { HeaderInfo } from "../types";
import { container } from '../di/container';
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
     * @param input - input stream or file path
     * @param headerInfo - header containing firstDirSector and sectorSize
     * @param rootStreamBuffer - buffer of the root entry that contains mini-stream
     */
    async loadMiniStream(input: string | Readable, headerInfo: HeaderInfo, rootStreamBuffer: Buffer) {
        // The mini-stream is stored as a normal stream in FAT
        // Here we just assign it to buffer, it could also be read from input via FATReader
        this.miniStreamBuffer = rootStreamBuffer;
        this.miniSectorSize = headerInfo.miniSectorSize ?? 64;
    }

    /**
     * Reads a mini-stream entry using MiniFAT
     * @param entry - DirectoryEntry with startingSectorLocation and streamSize
     */
    readMiniStream(entry: { startingSectorLocation: number, streamSize: number }): Buffer {
        const result = Buffer.alloc(entry.streamSize);
        let miniSector: number | null = entry.startingSectorLocation;
        let offset = 0;

        while (miniSector !== null) {
            const srcOffset = miniSector * this.miniSectorSize;
            const slice = this.miniStreamBuffer.subarray(srcOffset, srcOffset + this.miniSectorSize);

            slice.copy(result, offset);
            offset += slice.length;

            miniSector = this.miniFATReader.getNextMiniSector(miniSector);
        }

        return result.subarray(0, entry.streamSize);
    }
}


export function MiniStreamReaderFactory(): MiniStreamReader {
    const miniFAT =  container.resolve<MiniFATReader>('miniFATReaderFactory');
    return new MiniStreamReader(miniFAT);
}
