import type * as fs from 'node:fs';
import type { Readable } from 'node:stream';

export type InputSource = string | Buffer | Readable;

export interface RandomAccessSource {
    read(offset: number, length: number): Promise<Buffer>;
    close(): Promise<void>;
}

export type RandomAccessInput = RandomAccessSource | Buffer;

export async function readAt(input: RandomAccessInput, offset: number, length: number): Promise<Buffer> {
    validateRange(offset, length);
    return Buffer.isBuffer(input)
        ? input.subarray(offset, offset + length)
        : input.read(offset, length);
}

class BufferSource implements RandomAccessSource {
    constructor(private readonly buffer: Buffer) {}

    async read(offset: number, length: number): Promise<Buffer> {
        return readAt(this.buffer, offset, length);
    }

    async close(): Promise<void> {}
}

class FileSource implements RandomAccessSource {
    constructor(
        private readonly path: string,
        private readonly fsModule: typeof fs,
    ) {}

    async read(offset: number, length: number): Promise<Buffer> {
        validateRange(offset, length);
        if (length === 0) return Buffer.alloc(0);

        const handle = await this.fsModule.promises.open(this.path, 'r');
        const result = Buffer.alloc(length);
        let bytesRead = 0;

        try {
            while (bytesRead < length) {
                const read = await handle.read(result, bytesRead, length - bytesRead, offset + bytesRead);
                if (read.bytesRead === 0) break;
                bytesRead += read.bytesRead;
            }
        } finally {
            await handle.close();
        }

        return result.subarray(0, bytesRead);
    }

    async close(): Promise<void> {}
}

class ReadableSource implements RandomAccessSource {
    private readonly iterator: AsyncIterator<unknown>;
    private readonly chunks: Array<{ offset: number; data: Buffer }> = [];
    private bufferedLength = 0;
    private ended = false;
    private failure: unknown;
    private fillQueue: Promise<void> = Promise.resolve();

    constructor(input: Readable) {
        this.input = input;
        this.iterator = input[Symbol.asyncIterator]();
    }

    private readonly input: Readable;

    async read(offset: number, length: number): Promise<Buffer> {
        validateRange(offset, length);
        if (length === 0) return Buffer.alloc(0);

        await this.ensureBuffered(offset + length);
        if (this.failure) throw this.failure;
        if (offset >= this.bufferedLength) return Buffer.alloc(0);

        const available = Math.min(length, this.bufferedLength - offset);
        const result = Buffer.allocUnsafe(available);
        let written = 0;

        for (const chunk of this.chunks) {
            const chunkEnd = chunk.offset + chunk.data.length;
            if (chunkEnd <= offset) continue;
            if (chunk.offset >= offset + available) break;

            const sourceStart = Math.max(0, offset - chunk.offset);
            const sourceEnd = Math.min(chunk.data.length, offset + available - chunk.offset);
            chunk.data.copy(result, written, sourceStart, sourceEnd);
            written += sourceEnd - sourceStart;
        }

        return result;
    }

    async close(): Promise<void> {
        this.ended = true;
        if (!this.input.destroyed) this.input.destroy();
    }

    private async ensureBuffered(targetLength: number): Promise<void> {
        const fill = this.fillQueue.then(async () => {
            if (this.failure) throw this.failure;

            try {
                while (!this.ended && this.bufferedLength < targetLength) {
                    const next = await this.iterator.next();
                    if (next.done) {
                        this.ended = true;
                        break;
                    }

                    const data = toBuffer(next.value);
                    if (data.length === 0) continue;
                    this.chunks.push({ offset: this.bufferedLength, data });
                    this.bufferedLength += data.length;
                }
            } catch (error) {
                this.failure = error;
                throw error;
            }
        });

        this.fillQueue = fill.catch(() => undefined);
        await fill;
    }
}

export function createRandomAccessSource(input: InputSource, fsModule: typeof fs): RandomAccessSource {
    if (Buffer.isBuffer(input)) return new BufferSource(input);
    if (typeof input === 'string') return new FileSource(input, fsModule);
    return new ReadableSource(input);
}

function validateRange(offset: number, length: number): void {
    if (!Number.isSafeInteger(offset) || offset < 0) {
        throw new RangeError(`Invalid read offset: ${offset}`);
    }
    if (!Number.isSafeInteger(length) || length < 0) {
        throw new RangeError(`Invalid read length: ${length}`);
    }
}

function toBuffer(value: unknown): Buffer {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    if (typeof value === 'string') return Buffer.from(value);
    throw new TypeError('Readable MSG input must emit Buffer, Uint8Array, or string chunks');
}
