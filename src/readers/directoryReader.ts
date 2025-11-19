import { container } from "../di/container";
import { Readable } from 'stream';
import { CFBFConstants } from "../constants/cfbf";
import { FATReader } from "./fatReader";
import { MiniFATReader } from "./miniFATReader";
import { MiniStreamReader } from "./miniStreamReader";
import { DirectoryEntryRaw, DirectoryEntryType, DirectoryNode, HeaderInfo } from "../types";

export class DirectoryReader {
    private readonly constants: CFBFConstants;
    private entries: DirectoryEntryRaw[] = [];
    private nodesBySid: Map<number, DirectoryNode> = new Map();
    private root: DirectoryNode | null = null;
    private fatReader: FATReader | null = null;
    private miniFATReader: MiniFATReader | null = null;
    private miniStreamReader: MiniStreamReader | null = null;

    constructor(
        constants: CFBFConstants, 
        fatReader:FATReader, 
        miniFATReader:MiniFATReader, 
        miniStreamReader:MiniStreamReader
    ) {
        this.constants = constants;
        this.fatReader = fatReader;
        this.miniFATReader = miniFATReader;
        this.miniStreamReader = miniStreamReader;
    }

    /**
     * Reads all directory sectors using FAT chain
     */
    async readDirectorySectors(input: string | Readable, headerInfo: HeaderInfo): Promise<Buffer> {
      
        // Ensure FAT table is available for this instance
        await this.fatReader?.buildTable(input, headerInfo);

        // Validate starting sector
        const start = headerInfo.dirSectorLocation;
        if (!Number.isInteger(start) || start < 0 || start === 0xFFFFFFFE || start === 0xFFFFFFFF) {
            throw new Error(`Invalid directory start sector: ${start}`);
        }
        return this.fatReader?.readChain(input, headerInfo.dirSectorLocation, headerInfo);
    }

    /**
     * Parse 128-byte directory entries from a concatenated directory sector buffer
     */
    parseDirectoryEntries(buffer: Buffer): DirectoryEntryRaw[] {
        const ENTRY_SIZE = 128;
        const entries: DirectoryEntryRaw[] = [];
        const total = Math.floor(buffer.length / ENTRY_SIZE);

        for (let sid = 0; sid < total; sid++) {
            const offset = sid * ENTRY_SIZE;
            const view = buffer.subarray(offset, offset + ENTRY_SIZE);

            // name and length
            const nameLength = view.readUInt16LE(0x40);
            let name = '';
            if (nameLength >= 2) {
                const nameBytes = view.subarray(0x00, 0x00 + nameLength - 2); // trim trailing null
                name = nameBytes.toString('utf16le');
            }

            const type = view.readUInt8(0x42) as DirectoryEntryType;
            const colorFlag = view.readUInt8(0x43);
            const leftSiblingSid = view.readInt32LE(0x44);
            const rightSiblingSid = view.readInt32LE(0x48);
            const childSid = view.readInt32LE(0x4C);

            const clsidBuf = view.subarray(0x50, 0x60);
            const isZeroClsid = clsidBuf.every((b) => b === 0);
            const clsid = isZeroClsid ? null : clsidBuf.toString('hex');

            const stateBits = view.readUInt32LE(0x60);
            const creationTimeLow = view.readUInt32LE(0x64);
            const creationTimeHigh = view.readUInt32LE(0x68);
            const modifiedTimeLow = view.readUInt32LE(0x6C);
            const modifiedTimeHigh = view.readUInt32LE(0x70);

            const creationTime = creationTimeLow === 0 && creationTimeHigh === 0
                ? undefined
                : (BigInt(creationTimeHigh) << 32n) + BigInt(creationTimeLow);
            const modifiedTime = modifiedTimeLow === 0 && modifiedTimeHigh === 0
                ? undefined
                : (BigInt(modifiedTimeHigh) << 32n) + BigInt(modifiedTimeLow);

            const startingSectorLocation = view.readUInt32LE(0x74);
            const streamSize = Number(view.readBigUInt64LE(0x78));

            // Basic validation of type
            if (![
                DirectoryEntryType.Empty,
                DirectoryEntryType.Storage,
                DirectoryEntryType.Stream,
                DirectoryEntryType.Root
            ].includes(type)) {
                continue;
            }

            entries.push({
                sid,
                name,
                type,
                colorFlag,
                leftSiblingSid,
                rightSiblingSid,
                childSid,
                clsid,
                stateBits,
                creationTime: creationTime as any,
                modifiedTime: modifiedTime as any,
                startingSectorLocation,
                streamSize
            });
        }

        this.entries = entries;
        return entries;
    }

    /**
     * Build a navigable tree from parsed entries
     */
    buildDirectoryTree(): DirectoryNode | null {
        if (this.entries.length === 0) return null;

        // Initialize nodes
        this.nodesBySid.clear();
        for (const e of this.entries) {
            const node: DirectoryNode = {
                sid: e.sid,
                name: e.name,
                type: e.type,
                startingSectorLocation: e.startingSectorLocation,
                streamSize: e.streamSize,
                children: [],
                parentSid: null
            };
            this.nodesBySid.set(e.sid, node);
        }

        const entryBySid = new Map<number, DirectoryEntryRaw>(this.entries.map(e => [e.sid, e]));

        const NOSTREAM = -1;

        const traverseSiblingTree = (sid: number, parentSid: number | null, acc: DirectoryNode[]) => {
            if (sid === NOSTREAM) return;
            const entry = entryBySid.get(sid);
            if (!entry) return;

            // in-order: left, self, right
            traverseSiblingTree(entry.leftSiblingSid, parentSid, acc);

            const node = this.nodesBySid.get(sid)!;
            node.parentSid = parentSid;
            acc.push(node);

            traverseSiblingTree(entry.rightSiblingSid, parentSid, acc);
        };

        const buildSubtree = (sid: number, parentSid: number | null): DirectoryNode[] => {
            const list: DirectoryNode[] = [];
            traverseSiblingTree(sid, parentSid, list);
            for (const node of list) {
                const entry = entryBySid.get(node.sid)!;
                const children = buildSubtree(entry.childSid, node.sid);
                node.children = children;
            }
            return list;
        };

        // Find root entry
        const rootEntry = this.entries.find(e => e.type === DirectoryEntryType.Root);
        if (!rootEntry) {
            this.root = null;
            return null;
        }

        const rootNode = this.nodesBySid.get(rootEntry.sid)!;
        rootNode.parentSid = null;
        rootNode.children = buildSubtree(rootEntry.childSid, rootNode.sid);
        this.root = rootNode;
        return this.root;
    }

    getTree(): DirectoryNode | null {
        return this.root;
    }

    getEntryBySid(sid: number): DirectoryNode | undefined {
        return this.nodesBySid.get(sid);
    }

    findByPath(path: string[]): DirectoryNode | null {
        if (!this.root || path.length === 0) return null;
        let current: DirectoryNode | undefined = this.root;
        // Allow paths with or without Root name
        const startIndex = (path[0] === this.root.name) ? 1 : 0;
        for (let i = startIndex; i < path.length; i++) {
            const part = path[i];
            current = current?.children.find(c => c.name === part);
            if (!current) return null;
        }
        return current ?? null;
    }

    /**
     * Convenience: end-to-end load of directory (read sectors, parse, build tree)
     */
    async loadDirectory(input: string | Readable, headerInfo: HeaderInfo): Promise<DirectoryNode | null> {
        const buffer = await this.readDirectorySectors(input, headerInfo);
        this.parseDirectoryEntries(buffer);
        return this.buildDirectoryTree();
    }

    /**
     * Initialize MiniFAT and MiniStream from Root Entry stream
     */
    async initializeMiniStream(input: string | Readable, headerInfo: HeaderInfo): Promise<void> {
    
        await this.miniFATReader?.buildMiniFAT(input, headerInfo);

        await this.fatReader?.buildTable(input, headerInfo);
  
        if (!this.root) {
            throw new Error('Root directory not loaded');
        }
        // Root entry stream stores the mini-stream content
        const rootStreamChain = await this.fatReader?.readChain(input, this.root.startingSectorLocation, headerInfo);
        const rootStreamBuffer = rootStreamChain.subarray(0, this.root.streamSize);

        await this.miniStreamReader?.loadMiniStream(input, headerInfo, rootStreamBuffer);
    }

    /**
     * Read a stream by SID, choosing MiniStream or regular FAT by size
     */
    async readStreamBySid(input: string | Readable, headerInfo: HeaderInfo, sid: number): Promise<Buffer> {
      
        await this.fatReader?.buildTable(input, headerInfo);
   
        const node = this.nodesBySid.get(sid);
        if (!node) throw new Error(`Directory entry SID ${sid} not found`);

        const isMini = node.streamSize < headerInfo.miniStreamCutoffSize;
        if (isMini) {
            if (!this.miniFATReader || !this.miniStreamReader) {
                await this.initializeMiniStream(input, headerInfo);
            }
            return this.miniStreamReader!.readMiniStream({
                startingSectorLocation: node.startingSectorLocation,
                streamSize: node.streamSize
            });
        }

        const chain = await this.fatReader?.readChain(input, node.startingSectorLocation, headerInfo);
        return chain.subarray(0, node.streamSize);
    }

    async readStreamByPath(input: string | Readable, headerInfo: HeaderInfo, path: string[]): Promise<Buffer | null> {
        const node = this.findByPath(path);
        if (!node) return null;
        return this.readStreamBySid(input, headerInfo, node.sid);
    }
}

export function DirectoryReaderFactory(): DirectoryReader {
    const constants = container.get<CFBFConstants>("CFBFConstants");
    const fatReader = container.get<FATReader>('fatReader');
    const miniFATFactory = container.get<MiniFATReader>('miniFATReader');
    const miniStreamFactory = container.get<MiniStreamReader>('miniStreamReader');
    return new DirectoryReader(constants, fatReader, miniFATFactory, miniStreamFactory);
}

