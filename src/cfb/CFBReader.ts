import { trimNullPadding } from '../utils/utils';
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
import { Decoder } from '../encoding/decoder';
import { CodePageReader } from '../mapi/CodePageReader';
import { PropertyStreamReader } from '../mapi/PropertyStreamReader';
import { DEFAULT_MAX_RESULT_BYTES } from '../api/options';

export interface ICFBFReader {
    load(input: InputSource, options?: InputSourceOptions): Promise<void>;
    readStream(path: string[]): Promise<Buffer | null>;
    readStreamAsString(path: string[], propertyType?: number): Promise<string | null>;
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
    private maxResultBytes = DEFAULT_MAX_RESULT_BYTES;
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
        this.maxResultBytes = options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;
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

        const size = this.getStreamSize(path);
        if (size !== null && size > this.maxResultBytes) {
            throw new RangeError(`MSG result exceeds maxResultBytes (${this.maxResultBytes})`);
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
                return trimNullPadding(buffer.toString('utf16le'));
            case 0x001E: // PT_STRING8
            {
                const embeddedRootIndex = path.lastIndexOf('__substg1.0_3701000D');
                const rootName = this.tree?.name ?? 'Root Entry';
                const storagePath = embeddedRootIndex < 0 ? [] : path.slice(0, embeddedRootIndex + 1);
                const rootStorage = storagePath[0] === rootName
                    ? storagePath
                    : [rootName, ...storagePath];
                const codepage = await new CodePageReader(
                    new PropertyStreamReader(this),
                    rootStorage,
                ).getCodepage();
                return trimNullPadding(new Decoder().decodeBytes(buffer, codepage));
            }
            case 0x0102: // PT_BINARY
                return buffer.toString('hex');
            default:
                return buffer.toString();
        }
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
