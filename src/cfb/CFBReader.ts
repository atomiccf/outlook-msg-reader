import type { DirectoryNode } from '../types';
import type { HeaderReader } from './readers/headerReader';
import type { FATReader } from './readers/fatReader';
import { DirectoryReader } from './readers/directoryReader';
import type { HeaderInfo } from '../types';
import type { Resolver } from '../di/service-locator';
import { TOKENS } from '../di/tokens';
import type { InputSource } from './InputSource';
import { InvalidCfbfError } from '../errors/errors';

export interface ICFBFReader {
    load(input: InputSource): Promise<void>;
    readStream(path: string[]): Promise<Buffer | null>;
    readStreamAsString(path: string[], propertyType?: number): Promise<string | null>;
    getTree(): DirectoryNode | null;
    getHeaderInfo(): HeaderInfo;
}

export class CFBFReader implements ICFBFReader {
    private tree: DirectoryNode | null = null;
    private headerInfo!: HeaderInfo;
    private input!: InputSource;
    private readonly headerReader: HeaderReader;
    private readonly fatReader: FATReader;
    private readonly directoryReader: DirectoryReader;

    constructor(headerReader: HeaderReader, fatReader: FATReader, directoryReader: DirectoryReader) {
        this.headerReader = headerReader;
        this.fatReader = fatReader;
        this.directoryReader = directoryReader;
    }

    async load(input: InputSource) {
        this.input = input;

        const { header } = await this.headerReader.readHeaderWithStream(input);

        this.headerInfo = {
            sectorSize: 1 << header.readUInt16LE(30),
            miniSectorSize: 1 << header.readUInt16LE(32),
            numFATSectors: header.readUInt32LE(44),
            dirSectorLocation: header.readUInt32LE(48),
            numDirectorySectors: header.readUInt32LE(40),
            miniStreamCutoffSize: header.readUInt32LE(56),
            miniFatStartSector: header.readUInt32LE(0x3C),
            miniFatSectorCount: header.readUInt32LE(0x40),
            fatSectorLocations: Array.from({ length: 109 }, (_, i) => header.readUInt32LE(76 + i * 4)).filter(v => v !== 0xFFFFFFFF),
            signature: header.subarray(0, 8),
            rawHeader: header
        };

        await this.fatReader.buildTable(input, this.headerInfo);
        await this.directoryReader.loadDirectory(input, this.headerInfo);

        this.tree = this.directoryReader.getTree();
    }

    async readStream(path: string[]): Promise<Buffer | null> {
        if (!this.headerInfo || !this.tree) {
            throw new InvalidCfbfError('CFBF is not loaded or its directory tree is empty');
        }

        return this.directoryReader.readStreamByPath(
            this.input,
            this.headerInfo,
            path
        );
    }

    async readStreamAsString(path: string[], propertyType?: number): Promise<string | null> {
        const buffer = await this.readStream(path);
        if (!buffer) return null;

        if (!propertyType) return buffer.toString(); // fallback

        switch (propertyType) {
            case 0x001F: // PT_UNICODE
                return buffer.toString('utf16le').replace(/\0/g, '');
            case 0x001E: // PT_STRING8
                return buffer.toString('latin1').replace(/\0/g, '');
            case 0x0102: // PT_BINARY
                return buffer.toString('hex');
            default:
                return buffer.toString();
        }
    }

    getTree(): DirectoryNode | null {
        return this.tree;
    }

    getHeaderInfo(): HeaderInfo {
        return this.headerInfo;
    }
}

export function CFBFReaderFactory(resolver: Resolver): CFBFReader {
    const headerReader = resolver.get(TOKENS.headerReader);
    const fatReader = resolver.get(TOKENS.fatReader);
    const directoryReader = resolver.get(TOKENS.directoryReader);
    return new CFBFReader(headerReader, fatReader, directoryReader);
}
