import type * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

export type InputSource = string | Buffer | Readable;

export interface InputSourceOptions {
    /** Maximum size of a Buffer, file, or complete Readable input. Unlimited by default. */
    maxInputBytes?: number;
    /** Bytes retained in memory before a Readable input spills to a temporary file. */
    streamMemoryThreshold?: number;
    /** Maximum directory nesting below the CFBF root. Defaults to 128. */
    maxDirectoryDepth?: number;
}

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
    private handle?: Promise<fs.promises.FileHandle>;
    private closed = false;
    private sizeChecked = false;

    constructor(
        private readonly path: string,
        private readonly fsModule: typeof fs,
        private readonly maxInputBytes?: number,
    ) {}

    async read(offset: number, length: number): Promise<Buffer> {
        validateRange(offset, length);
        if (this.closed) throw new Error('Cannot read from a closed MSG input');
        if (!this.sizeChecked && this.maxInputBytes !== undefined) {
            const size = (await this.fsModule.promises.stat(this.path)).size;
            if (size > this.maxInputBytes) {
                throw new RangeError(`File MSG input exceeds maxInputBytes (${this.maxInputBytes})`);
            }
            this.sizeChecked = true;
        }
        if (length === 0) return Buffer.alloc(0);

        const handle = await this.getHandle();
        const result = Buffer.alloc(length);
        let bytesRead = 0;

        while (bytesRead < length) {
            const read = await handle.read(result, bytesRead, length - bytesRead, offset + bytesRead);
            if (read.bytesRead === 0) break;
            bytesRead += read.bytesRead;
        }

        return result.subarray(0, bytesRead);
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        if (this.handle) await (await this.handle).close();
    }

    private getHandle(): Promise<fs.promises.FileHandle> {
        return this.handle ??= this.fsModule.promises.open(this.path, 'r');
    }
}

class ReadableSource implements RandomAccessSource {
    private readonly iterator: AsyncIterator<unknown>;
    private readonly chunks: Array<{ offset: number; data: Buffer }> = [];
    private bufferedLength = 0;
    private ended = false;
    private failure: unknown;
    private fillQueue: Promise<void> = Promise.resolve();
    private tempDirectory?: string;
    private tempHandle?: fs.promises.FileHandle;
    private readonly memoryThreshold: number;
    private readonly maxInputBytes?: number;

    constructor(
        input: Readable,
        private readonly fsModule: typeof fs,
        options: InputSourceOptions,
    ) {
        this.input = input;
        this.iterator = input[Symbol.asyncIterator]();
        this.memoryThreshold = options.streamMemoryThreshold ?? 8 * 1024 * 1024;
        this.maxInputBytes = options.maxInputBytes;
        validateLimit('streamMemoryThreshold', this.memoryThreshold);
        if (this.maxInputBytes !== undefined) validateLimit('maxInputBytes', this.maxInputBytes);
    }

    private readonly input: Readable;

    async read(offset: number, length: number): Promise<Buffer> {
        validateRange(offset, length);
        if (length === 0 && this.maxInputBytes === undefined) return Buffer.alloc(0);

        await this.ensureBuffered(this.maxInputBytes === undefined ? offset + length : Number.POSITIVE_INFINITY);
        if (this.failure) throw this.failure;
        if (length === 0) return Buffer.alloc(0);
        if (offset >= this.bufferedLength) return Buffer.alloc(0);

        const available = Math.min(length, this.bufferedLength - offset);
        const result = Buffer.allocUnsafe(available);
        if (this.tempHandle) {
            let bytesRead = 0;
            while (bytesRead < available) {
                const read = await this.tempHandle.read(
                    result,
                    bytesRead,
                    available - bytesRead,
                    offset + bytesRead,
                );
                if (read.bytesRead === 0) break;
                bytesRead += read.bytesRead;
            }
            return result.subarray(0, bytesRead);
        }

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
        if (this.tempHandle) {
            await this.tempHandle.close();
            this.tempHandle = undefined;
        }
        if (this.tempDirectory) {
            await this.fsModule.promises.rm(this.tempDirectory, { recursive: true, force: true });
            this.tempDirectory = undefined;
        }
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
                    const nextLength = this.bufferedLength + data.length;
                    if (this.maxInputBytes !== undefined && nextLength > this.maxInputBytes) {
                        throw new RangeError(`Readable MSG input exceeds maxInputBytes (${this.maxInputBytes})`);
                    }
                    if (!this.tempHandle && nextLength > this.memoryThreshold) {
                        await this.spillToDisk();
                    }
                    if (this.tempHandle) {
                        await writeAll(this.tempHandle, data, this.bufferedLength);
                    } else {
                        this.chunks.push({ offset: this.bufferedLength, data });
                    }
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

    private async spillToDisk(): Promise<void> {
        this.tempDirectory = await this.fsModule.promises.mkdtemp(join(tmpdir(), 'msg-js-'));
        this.tempHandle = await this.fsModule.promises.open(join(this.tempDirectory, 'input.msg'), 'w+');
        for (const chunk of this.chunks) {
            await writeAll(this.tempHandle, chunk.data, chunk.offset);
        }
        this.chunks.length = 0;
    }
}

export function createRandomAccessSource(
    input: InputSource,
    fsModule: typeof fs,
    options: InputSourceOptions = {},
): RandomAccessSource {
    if (options.maxInputBytes !== undefined) validateLimit('maxInputBytes', options.maxInputBytes);
    if (Buffer.isBuffer(input)) {
        if (options.maxInputBytes !== undefined && input.length > options.maxInputBytes) {
            throw new RangeError(`Buffer MSG input exceeds maxInputBytes (${options.maxInputBytes})`);
        }
        return new BufferSource(input);
    }
    if (typeof input === 'string') return new FileSource(input, fsModule, options.maxInputBytes);
    return new ReadableSource(input, fsModule, options);
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

function validateLimit(name: string, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`);
    }
}

async function writeAll(handle: fs.promises.FileHandle, data: Buffer, position: number): Promise<void> {
    let written = 0;
    while (written < data.length) {
        const result = await handle.write(data, written, data.length - written, position + written);
        if (result.bytesWritten === 0) throw new Error('Unable to write temporary MSG input');
        written += result.bytesWritten;
    }
}
