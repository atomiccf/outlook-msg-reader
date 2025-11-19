import { Readable } from 'stream';
import { HeaderInfo } from "../../types";
import { container } from '../../di/container';
import type * as fs from "fs";
import { parseUint32Array } from "../../utils/utils";

export class FATReader {
    private fatTable: Record<number, number> = {};
    private readonly fs: typeof fs

    constructor(fsModule: typeof fs){
        this.fs = fsModule;
    }

    async buildTable(input: string | Readable, headerInfo: HeaderInfo) {
        for (const sectorIndex of headerInfo.fatSectorLocations) {
            const sectorBytes = await this.readSector(input, sectorIndex, headerInfo);
            const entries = parseUint32Array(sectorBytes);


            for (let i = 0; i < entries.length; i++) {
                const actualIndex = sectorIndex * (headerInfo.sectorSize / 4) + i;
                this.fatTable[actualIndex] = entries[i];
            }
        }

        return this.fatTable;
    }

    async readSector(input: string | Readable, sectorIndex: number, headerInfo: HeaderInfo): Promise<Buffer> {

        if (!Number.isInteger(sectorIndex) || sectorIndex < 0) {
            throw new Error(`Invalid sector index: ${sectorIndex}`);
        }
        const offset = (sectorIndex + 1) * headerInfo.sectorSize;

        let stream: Readable;
        if (typeof input === 'string') {
            stream = this.fs.createReadStream(input, {
                start: offset,
                end: offset + headerInfo.sectorSize - 1
            });
        } else {
            stream = input;
        }

        return this.#readFully(stream, headerInfo.sectorSize);
    }

    getNextSector(sectorIndex: number): number | null {
        const next = this.fatTable[sectorIndex];
        if (next === undefined) return null;
        // Treat special markers as chain termination for our traversal
        if (next >= 0xFFFFFFFC) return null; // DIFSECT, FATSECT, ENDOFCHAIN
        return next;
    }

    /**
     * Reads a whole sector chain starting at startSector (following FAT) and
     * returns a concatenated buffer of all sectors in the chain.
     * Requires buildTable() to be called beforehand.
     */
    async readChain(input: string | Readable, startSector: number, headerInfo: HeaderInfo): Promise<Buffer> {
        if (!this.fatTable || Object.keys(this.fatTable).length === 0) {
            throw new Error('FAT table is empty. Call buildTable() before readChain.');
        }

        const visited = new Set<number>();
        const buffers: Buffer[] = [];

        let sector: number | null = startSector;
        while (sector !== null) {
            if (visited.has(sector)) {
                throw new Error('FAT sector chain loop detected');
            }
            visited.add(sector);

            const bytes = await this.readSector(input, sector, headerInfo);
            buffers.push(bytes);

            sector = this.getNextSector(sector);
        }

        return Buffer.concat(buffers);
    }

    async #readFully(stream: Readable, size: number): Promise<Buffer> {
        const chunks: Buffer[] = [];
        let bytesRead = 0;

        return new Promise((resolve, reject) => {
            stream.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
                bytesRead += chunk.length;

                if (bytesRead >= size) {
                    stream.pause();
                    resolve(Buffer.concat(chunks, size));
                }
            });

            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
        });
    }
}

export function FATReaderFactory(): FATReader {
    const fsModule = container.get<typeof fs>('fs');
    return new FATReader(fsModule);
}
