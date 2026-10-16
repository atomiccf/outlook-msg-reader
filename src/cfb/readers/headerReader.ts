import { CFBFConstants } from '../../constants/cfbf';
import type * as fs from 'fs';
import { Readable } from 'stream';
import type { Resolver } from '../../di/service-locator';
import { TOKENS } from '../../di/tokens';
import { InvalidCfbfError } from '../../errors/errors';
import type { InputSource } from '../InputSource';


export class HeaderReader {
    private readonly constants: CFBFConstants;
    private readonly fs: typeof fs

    constructor(constants: CFBFConstants, fsModule: typeof fs) {
        this.constants = constants;
        this.fs = fsModule;
    }

    /**
     * Reads the header from a file (only the first 512 bytes)
     */
    async readHeaderWithStream(input: InputSource): Promise<{ header: Buffer; stream: Readable }> {
        const stream = this.#convertInputToStream(input);
        const header = await this.#readHeaderBytes(stream, this.constants.HEADER_SIZE);

        if (header.length < this.constants.HEADER_SIZE) {
            throw new InvalidCfbfError('CFBF header is incomplete');
        }
        if (!this.#validateSignatures(header)) {
            throw new InvalidCfbfError('Invalid CFBF file signature');
        }

        return { header, stream };
    }

    /**
     * Private method: reads exactly `length` bytes from the stream
     */
    async #readHeaderBytes(stream: Readable, length: number): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            let bytesRead = 0;

            const onData = (chunk: Buffer) => {
                if (bytesRead + chunk.length >= length) {
                    const needed = length - bytesRead;
                    chunks.push(chunk.subarray(0, needed));
                    bytesRead += needed;

                    cleanup();

                    // push leftover back to the stream
                    const leftover = chunk.subarray(needed);
                    if (leftover.length > 0) stream.unshift(leftover);

                    resolve(Buffer.concat(chunks));
                } else {
                    chunks.push(chunk);
                    bytesRead += chunk.length;
                }
            };

            const onEnd = () => {
                cleanup();
                resolve(Buffer.concat(chunks)); // in case file is smaller than `length`
            };

            const onError = (err: Error) => {
                cleanup();
                reject(err);
            };

            const cleanup = () => {
                stream.removeListener('data', onData);
                stream.removeListener('end', onEnd);
                stream.removeListener('error', onError);
            };

            stream.on('data', onData);
            stream.on('end', onEnd);
            stream.on('error', onError);
        });
    }


    /**
     * Converts a file path into a ReadStream (reads only the first 512 bytes)
     */
    #convertInputToStream(input: InputSource): Readable {
        if (Buffer.isBuffer(input)) return Readable.from([input]);

        if (!this.fs?.createReadStream) {
            throw new Error('FS module not available');
        }

        return this.fs.createReadStream(input);
    }

    #validateSignatures(headerBytes: Buffer): boolean {
        const signature = headerBytes.subarray(0, 8);
        const expected = Buffer.from(this.constants.CFBF_SIGNATURE);
        return signature.equals(expected);
    }

}

/**
 * Factory function to create HeaderReader with dependencies from the DI container
 */
export function HeaderReaderFactory(resolver: Resolver): HeaderReader {
    const constants = resolver.get(TOKENS.cfbfConstants);
    const fsModule = resolver.get(TOKENS.fs);
    return new HeaderReader(constants, fsModule);
}
