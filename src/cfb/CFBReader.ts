import type { DirectoryNode } from '../types';
import type { HeaderReader } from './readers/headerReader';
import type { FATReader } from './readers/fatReader';
import { DirectoryReader } from './readers/directoryReader';
import type { HeaderInfo } from '../types';
import type { Resolver } from '../di/service-locator';
import { TOKENS } from '../di/tokens';
import type { InputSource, InputSourceOptions, RandomAccessSource } from './InputSource';
import { InvalidCfbfError } from '../errors/errors';
import { Readable } from 'node:stream';

export interface ICFBFReader {
    load(input: InputSource, options?: InputSourceOptions): Promise<void>;
    readStream(path: string[]): Promise<Buffer | null>;
    openStream(path: string[]): Promise<Readable | null>;
    getStreamSize(path: string[]): number | null;
    close(): Promise<void>;
    getTree(): DirectoryNode | null;
    getHeaderInfo(): HeaderInfo;
    finishInput(): Promise<void>;
}

export class CFBFReader implements ICFBFReader {
    private tree: DirectoryNode | null = null;
    private headerInfo!: HeaderInfo;
    private input?: RandomAccessSource;
    private readonly headerReader: HeaderReader;
    private readonly fatReader: FATReader;
    private readonly directoryReader: DirectoryReader;

    constructor(headerReader: HeaderReader, fatReader: FATReader, directoryReader: DirectoryReader) {
        this.headerReader = headerReader;
        this.fatReader = fatReader;
        this.directoryReader = directoryReader;
    }

    async load(input: InputSource, options: InputSourceOptions = {}) {
        await this.close();
        if (options.maxResultBytes !== undefined &&
            (!Number.isSafeInteger(options.maxResultBytes) || options.maxResultBytes < 0)) {
            throw new RangeError('maxResultBytes must be a non-negative safe integer');
        }
        if (options.maxDirectoryBytes !== undefined &&
            (!Number.isSafeInteger(options.maxDirectoryBytes) || options.maxDirectoryBytes < 0)) {
            throw new RangeError('maxDirectoryBytes must be a non-negative safe integer');
        }
        const { header, source } = await this.headerReader.readHeaderWithSource(input, options);
        this.input = source;

        try {
            this.headerInfo = {
                majorVersion: header.readUInt16LE(0x1A) as 3 | 4,
                minorVersion: header.readUInt16LE(0x18),
                sectorSize: 1 << header.readUInt16LE(30),
                miniSectorSize: 1 << header.readUInt16LE(32),
                numFATSectors: header.readUInt32LE(44),
                dirSectorLocation: header.readUInt32LE(48),
                numDirectorySectors: header.readUInt32LE(40),
                miniStreamCutoffSize: header.readUInt32LE(56),
                miniFatStartSector: header.readUInt32LE(0x3C),
                miniFatSectorCount: header.readUInt32LE(0x40),
                difatStartSector: header.readUInt32LE(0x44),
                numDIFATSectors: header.readUInt32LE(0x48),
                fatSectorLocations: Array.from({ length: 109 }, (_, i) => header.readUInt32LE(76 + i * 4)).filter(v => v !== 0xFFFFFFFF),
                signature: header.subarray(0, 8),
                rawHeader: header
            };

            await this.fatReader.buildTable(source, this.headerInfo);
            await this.directoryReader.loadDirectory(
                source, this.headerInfo, options.maxDirectoryDepth, options.maxDirectoryBytes,
            );

            this.tree = this.directoryReader.getTree();
        } catch (error) {
            await this.close();
            throw error;
        }
    }

    async readStream(path: string[]): Promise<Buffer | null> {
        if (!this.headerInfo || !this.tree || !this.input) {
            throw new InvalidCfbfError('CFBF is not loaded or its directory tree is empty');
        }

        return this.directoryReader.readStreamByPath(
            this.input,
            this.headerInfo,
            path
        );
    }

    async openStream(path: string[]): Promise<Readable | null> {
        if (!this.headerInfo || !this.tree || !this.input) {
            throw new InvalidCfbfError('CFBF is not loaded or its directory tree is empty');
        }
        const chunks = await this.directoryReader.readStreamChunksByPath(this.input, this.headerInfo, path);
        return chunks ? Readable.from(chunks) : null;
    }

    getStreamSize(path: string[]): number | null {
        return this.directoryReader.findByPath(path)?.streamSize ?? null;
    }

    getTree(): DirectoryNode | null {
        return this.tree;
    }

    getHeaderInfo(): HeaderInfo {
        return this.headerInfo;
    }

    async finishInput(): Promise<void> {
        await this.input?.finish?.();
    }

    async close(): Promise<void> {
        const input = this.input;
        this.input = undefined;
        this.tree = null;
        await input?.close();
    }
}

export function CFBFReaderFactory(resolver: Resolver): CFBFReader {
    const headerReader = resolver.get(TOKENS.headerReader);
    const fatReader = resolver.get(TOKENS.fatReader);
    const directoryReader = resolver.get(TOKENS.directoryReader);
    return new CFBFReader(headerReader, fatReader, directoryReader);
}
