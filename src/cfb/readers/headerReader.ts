import { CFBFConstants } from '../../constants/cfbf';
import type * as fs from 'fs';
import type { Resolver } from '../../di/service-locator';
import { TOKENS } from '../../di/tokens';
import { InvalidCfbfError } from '../../errors/errors';
import { createRandomAccessSource, type InputSource, type RandomAccessSource } from '../InputSource';


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
    async readHeaderWithSource(input: InputSource): Promise<{ header: Buffer; source: RandomAccessSource }> {
        const source = createRandomAccessSource(input, this.fs);
        try {
            const header = await source.read(0, this.constants.HEADER_SIZE);

            if (header.length < this.constants.HEADER_SIZE) {
                throw new InvalidCfbfError('CFBF header is incomplete');
            }
            this.#validateHeader(header);

            return { header, source };
        } catch (error) {
            await source.close();
            throw error;
        }
    }

    #validateHeader(headerBytes: Buffer): void {
        const signature = headerBytes.subarray(0, 8);
        const expected = Buffer.from(this.constants.CFBF_SIGNATURE);
        if (!signature.equals(expected)) {
            throw new InvalidCfbfError('Invalid CFBF file signature');
        }

        if (!headerBytes.subarray(0x08, 0x18).every(byte => byte === 0)) {
            throw new InvalidCfbfError('CFBF header CLSID must be zero');
        }

        const majorVersion = headerBytes.readUInt16LE(0x1A);
        if (majorVersion !== 3 && majorVersion !== 4) {
            throw new InvalidCfbfError(`Unsupported CFBF major version: ${majorVersion}`);
        }

        const byteOrder = headerBytes.readUInt16LE(0x1C);
        if (byteOrder !== 0xFFFE) {
            throw new InvalidCfbfError(`Invalid CFBF byte order: 0x${byteOrder.toString(16).padStart(4, '0')}`);
        }

        const sectorShift = headerBytes.readUInt16LE(0x1E);
        const expectedSectorShift = majorVersion === 3 ? 9 : 12;
        if (sectorShift !== expectedSectorShift) {
            throw new InvalidCfbfError(
                `Invalid sector shift ${sectorShift} for CFBF version ${majorVersion}`
            );
        }

        const miniSectorShift = headerBytes.readUInt16LE(0x20);
        if (miniSectorShift !== 6) {
            throw new InvalidCfbfError(`Invalid mini sector shift: ${miniSectorShift}`);
        }

        if (!headerBytes.subarray(0x22, 0x28).every(byte => byte === 0)) {
            throw new InvalidCfbfError('CFBF header reserved bytes must be zero');
        }

        const directorySectorCount = headerBytes.readUInt32LE(0x28);
        if (majorVersion === 3 && directorySectorCount !== 0) {
            throw new InvalidCfbfError('Version 3 CFBF files must declare zero directory sectors');
        }

        const miniStreamCutoff = headerBytes.readUInt32LE(0x38);
        if (miniStreamCutoff !== 0x1000) {
            throw new InvalidCfbfError(`Invalid mini stream cutoff: ${miniStreamCutoff}`);
        }
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
