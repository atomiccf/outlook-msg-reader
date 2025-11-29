import type { DirectoryNode } from '../types';
import { container } from '../di/container';
import type { HeaderReader } from './readers/headerReader';
import type { FATReader } from './readers/fatReader';
import { DirectoryReader } from './readers/directoryReader';
import type { HeaderInfo } from '../types';


export interface ICFBFReader {
    load(filePath: string): Promise<void>;
    readStream(path: string[]): Promise<Buffer | null>;
    getTree(): DirectoryNode | null;
    getHeaderInfo(): HeaderInfo;
}

export class CFBFReader implements ICFBFReader {
    private tree: DirectoryNode | null = null;
    private headerInfo!: HeaderInfo;
    private filePath!: string;
    private readonly headerReader: HeaderReader;
    private readonly fatReader: FATReader;
    private readonly directoryReader: DirectoryReader;

    constructor(headerReader:HeaderReader,fatReader:FATReader,directoryReader:DirectoryReader) {
    this.headerReader = headerReader;
    this.fatReader = fatReader;
    this.directoryReader = directoryReader;
    }

    async load(filePath: string) {
        this.filePath = filePath;

        const { header } = await this.headerReader.readHeaderWithStream(filePath);

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

        await this.fatReader.buildTable(filePath, this.headerInfo);
        await this.directoryReader.loadDirectory(filePath, this.headerInfo);

        this.tree = this.directoryReader.getTree();
    }

    async readStream(path: string[]): Promise<Buffer | null> {
        if (!this.headerInfo) throw new Error('CFBF not loaded');

        return this.directoryReader.readStreamByPath(this.filePath, this.headerInfo, path);
    }

    getTree(): DirectoryNode | null {
        return this.tree;
    }

    getHeaderInfo(): HeaderInfo {
        return this.headerInfo;
    }
}

export function CFBFReaderFactory(): CFBFReader {
    const headerReader = container.get<HeaderReader>('headerReader');
    const fatReader = container.get<FATReader>('fatReader');
    const directoryReader = container.get<DirectoryReader>('directoryReader');
    return new CFBFReader(headerReader, fatReader, directoryReader);
}
