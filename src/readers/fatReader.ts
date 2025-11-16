import { Readable } from 'stream';
import { HeaderInfo } from "../types";
import { container } from '../di/container';
import type fs from "fs";
import { parseUint32Array } from "../utils/utils";

export class FATReader {
    private fatTable: Record<number, number> = {};

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
        const fsModule = container.resolve<typeof fs>('fs');
        const offset = (sectorIndex + 1) * headerInfo.sectorSize;

        let stream: Readable;
        if (typeof input === 'string') {
            stream = fsModule.createReadStream(input, {
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
        return next === 0xFFFFFFFE ? null : next; // ENDOFCHAIN
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
    return new FATReader();
}
