import {CFBFConstants} from "../../constants/cfbf";
import {FATReader} from "./fatReader";
import {MiniFATReader} from "./miniFATReader";
import {MiniStreamReader} from "./miniStreamReader";
import {DirectoryEntryRaw, DirectoryEntryType, DirectoryNode, HeaderInfo} from "../../types";
import type { Resolver } from '../../di/service-locator';
import { TOKENS } from '../../di/tokens';
import { CorruptedSectorChainError } from '../../errors/errors';
import type { RandomAccessSource } from '../InputSource';

export const DEFAULT_MAX_DIRECTORY_DEPTH = 128;

export class DirectoryReader {
    private entries: DirectoryEntryRaw[] = [];
    private nodesBySid: Map<number, DirectoryNode> = new Map();
    private root: DirectoryNode | null = null;
    private fatReader: FATReader | null = null;
    private miniFATReader: MiniFATReader | null = null;
    private miniStreamReader: MiniStreamReader | null = null;
    private miniStreamInitialized = false;
    private miniStreamInitialization?: Promise<void>;
    private cfbConstants:CFBFConstants;

    constructor(
        fatReader:FATReader,
        miniFATReader:MiniFATReader,
        miniStreamReader:MiniStreamReader,
        cfbConstants:CFBFConstants
    ) {
        this.fatReader = fatReader;
        this.miniFATReader = miniFATReader;
        this.miniStreamReader = miniStreamReader;
        this.cfbConstants = cfbConstants;
    }

    /**
     * Reads all directory sectors using FAT chain
     */
    async readDirectorySectors(input: RandomAccessSource, headerInfo: HeaderInfo): Promise<Buffer> {

        // Ensure FAT table is available for this instance
        if (!this.fatReader) {
            throw new Error('FATReader is not initialized');
        }
             // Validate starting sector
        const start = headerInfo.dirSectorLocation;
        if (start === 0xFFFFFFFE || start === 0xFFFFFFFF) {
            throw new CorruptedSectorChainError(`Invalid directory start sector: ${start}`);
        }
        const expectedSize = headerInfo.numDirectorySectors > 0
            ? headerInfo.numDirectorySectors * headerInfo.sectorSize
            : undefined;
        return this.fatReader.readChain(input, headerInfo.dirSectorLocation, headerInfo, expectedSize);
    }

    /**
     * Parse 128-byte directory entries from a concatenated directory sector buffer
     */
    parseDirectoryEntries(buffer: Buffer, headerInfo?: HeaderInfo): DirectoryEntryRaw[] {
        const ENTRY_SIZE = 128;
        const entries: DirectoryEntryRaw[] = [];
        const total = Math.floor(buffer.length / ENTRY_SIZE);

        for (let sid = 0; sid < total; sid++) {
            const offset = sid * ENTRY_SIZE;
            const view = buffer.subarray(offset, offset + ENTRY_SIZE);

            // name and length
            const nameLength = view.readUInt16LE(0x40);
            let name = '';
            if (nameLength !== 0) {
                if (nameLength < 2 || nameLength > 64 || nameLength % 2 !== 0) {
                    throw new CorruptedSectorChainError(
                        `Invalid directory entry name length ${nameLength} at SID ${sid}`
                    );
                }
                if (view.readUInt16LE(nameLength - 2) !== 0) {
                    throw new CorruptedSectorChainError(
                        `Directory entry name is not null-terminated at SID ${sid}`
                    );
                }
                const nameBytes = view.subarray(0x00, nameLength - 2); // trim trailing null
                name = nameBytes.toString('utf16le').replace(/\0+$/, '');
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
            const rawStreamSize = view.readBigUInt64LE(0x78);
            if (headerInfo?.majorVersion === 3 && rawStreamSize > 0xFFFFFFFFn) {
                throw new CorruptedSectorChainError(
                    `Version 3 directory entry SID ${sid} has a stream size larger than 32 bits`
                );
            }
            const streamSize = Number(rawStreamSize);
            if (!Number.isSafeInteger(streamSize)) {
                throw new CorruptedSectorChainError(`Unsafe stream size at directory entry SID ${sid}`);
            }

            // Basic validation of type
            if (![
                DirectoryEntryType.Empty,
                DirectoryEntryType.Storage,
                DirectoryEntryType.Stream,
                DirectoryEntryType.Root
            ].includes(type)) {
                throw new CorruptedSectorChainError(`Invalid directory entry type ${type} at SID ${sid}`);
            }
            if (type !== DirectoryEntryType.Empty && (colorFlag !== 0 && colorFlag !== 1)) {
                throw new CorruptedSectorChainError(`Invalid directory entry color ${colorFlag} at SID ${sid}`);
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
                creationTime,
                modifiedTime,
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
    buildDirectoryTree(maxDirectoryDepth = DEFAULT_MAX_DIRECTORY_DEPTH): DirectoryNode | null {
        if (!Number.isSafeInteger(maxDirectoryDepth) || maxDirectoryDepth < 0) {
            throw new RangeError('maxDirectoryDepth must be a non-negative safe integer');
        }
        if (this.entries.length === 0) return null;

        this.nodesBySid.clear();
        const entryBySid = new Map<number, DirectoryEntryRaw>();
        for (const e of this.entries) {
            entryBySid.set(e.sid, e);

            if (e.type === DirectoryEntryType.Empty) continue;

            const node: DirectoryNode = {
                sid: e.sid,
                name: e.name,
                type: e.type, // Use original DirectoryEntryType enum value
                startingSectorLocation: e.startingSectorLocation,
                streamSize: e.streamSize,
                children: [],
                parentSid: null
            };
            this.nodesBySid.set(e.sid, node);
        }

        const NOSTREAM = -1;
        const assigned = new Set<number>();

        const getReferencedEntry = (sid: number): DirectoryEntryRaw => {
            if (!Number.isInteger(sid) || sid < 0) {
                throw new CorruptedSectorChainError(`Invalid directory SID reference: ${sid}`);
            }
            const entry = entryBySid.get(sid);
            if (!entry || entry.type === DirectoryEntryType.Empty) {
                throw new CorruptedSectorChainError(`Directory SID ${sid} does not reference an active entry`);
            }
            return entry;
        };

        const traverseSiblingTree = (
            sid: number,
            parentSid: number | null,
        ): DirectoryNode[] => {
            const result: DirectoryNode[] = [];
            const visited = new Set<number>();
            const stack: number[] = [];
            let current = sid;

            while (current !== NOSTREAM && current !== 0xFFFFFFFF || stack.length > 0) {
                while (current !== NOSTREAM && current !== 0xFFFFFFFF) {
                    if (visited.has(current)) {
                        throw new CorruptedSectorChainError(`Directory sibling tree loop detected at SID ${current}`);
                    }
                    visited.add(current);
                    const entry = getReferencedEntry(current);
                    stack.push(current);
                    current = entry.leftSiblingSid;
                }

                const currentSid = stack.pop();
                if (currentSid === undefined) break;
                const entry = getReferencedEntry(currentSid);
                if (assigned.has(currentSid)) {
                    throw new CorruptedSectorChainError(`Directory SID ${currentSid} is referenced multiple times`);
                }
                assigned.add(currentSid);

                const node = this.nodesBySid.get(currentSid)!;
                node.parentSid = parentSid;
                result.push(node);
                current = entry.rightSiblingSid;
            }

            return result;
        };


        const buildSubtree = (
            sid: number,
            parentSid: number | null,
            depth: number,
        ): DirectoryNode[] => {
            if (sid === NOSTREAM || sid === 0xFFFFFFFF) return [];
            if (depth > maxDirectoryDepth) {
                throw new CorruptedSectorChainError(
                    `Directory depth exceeds maxDirectoryDepth (${maxDirectoryDepth})`
                );
            }

            const list = traverseSiblingTree(sid, parentSid);

            for (const node of list) {
                const entry = entryBySid.get(node.sid)!;
                node.children =
                    entry.childSid !== NOSTREAM && entry.childSid !== 0xFFFFFFFF
                        ? buildSubtree(entry.childSid, node.sid, depth + 1)
                        : [];
            }
            return list;
        };

        const rootEntry = this.entries[0];
        if (!rootEntry || rootEntry.type !== DirectoryEntryType.Root || rootEntry.name !== 'Root Entry') {
            throw new CorruptedSectorChainError('Directory SID 0 must be the Root Entry');
        }
        if (this.entries.slice(1).some(entry => entry.type === DirectoryEntryType.Root)) {
            throw new CorruptedSectorChainError('Directory contains multiple root entries');
        }

        const rootNode = this.nodesBySid.get(rootEntry.sid)!;
        rootNode.parentSid = null;
        assigned.add(rootEntry.sid);
        rootNode.children = buildSubtree(rootEntry.childSid, rootNode.sid, 1);
        this.root = rootNode;

        return this.root;
    }

    getTree(): DirectoryNode | null {
        return this.root;
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
    async loadDirectory(
        input: RandomAccessSource,
        headerInfo: HeaderInfo,
        maxDirectoryDepth?: number,
    ): Promise<DirectoryNode | null> {
        this.miniStreamInitialized = false;
        this.miniStreamInitialization = undefined;
        const buffer = await this.readDirectorySectors(input, headerInfo);
        this.parseDirectoryEntries(buffer, headerInfo);
        return this.buildDirectoryTree(maxDirectoryDepth);
    }

    /**
     * Initialize MiniFAT and MiniStream from Root Entry stream
     */
    async initializeMiniStream(input: RandomAccessSource, headerInfo: HeaderInfo): Promise<void> {
        if (this.miniStreamInitialized) return;
        if (this.miniStreamInitialization) return this.miniStreamInitialization;

        const initialization = (async () => {
            await this.miniFATReader?.buildMiniFAT(input, headerInfo);

            if (!this.root) {
                throw new Error('Root directory not loaded');
            }
            if (!this.fatReader) {
                throw new Error('FATReader is not initialized');
            }
            if (!this.miniStreamReader) {
                throw new Error('MiniStreamReader is not initialized');
            }

            await this.miniStreamReader.loadMiniStream(input, headerInfo, this.root);
            this.miniStreamInitialized = true;
        })();
        this.miniStreamInitialization = initialization;
        try {
            await initialization;
        } finally {
            if (this.miniStreamInitialization === initialization) {
                this.miniStreamInitialization = undefined;
            }
        }
    }

    /**
     * Read a stream by SID, choosing MiniStream or regular FAT by size
     */
    async readStreamBySid(
        input: RandomAccessSource,
        headerInfo: HeaderInfo,
        sid: number
    ): Promise<Buffer> {

        if (!this.fatReader) {
            throw new Error('FATReader is not initialized');
        }

        const node = this.nodesBySid.get(sid);
        if (!node) {
            throw new CorruptedSectorChainError(`Directory entry SID ${sid} not found`);
        }


        if (node.streamSize === 0) {
            return Buffer.alloc(0);
        }

         if (
            node.startingSectorLocation === this.cfbConstants.END_OF_CHAIN ||
            node.startingSectorLocation === this.cfbConstants.FREE_SECTOR
        ) {
            throw new CorruptedSectorChainError(
                `Corrupted stream "${node.name}": size=${node.streamSize}, sector=${node.startingSectorLocation}`
            );
        }

        const isMini = node.streamSize < headerInfo.miniStreamCutoffSize;

        if (isMini) {
            await this.initializeMiniStream(input, headerInfo);

            return await this.miniStreamReader!.readMiniStream({
                startingSectorLocation: node.startingSectorLocation,
                streamSize: node.streamSize
            });
        }

        const chain = await this.fatReader.readChain(
            input,
            node.startingSectorLocation,
            headerInfo,
            node.streamSize
        );

        return chain.subarray(0, node.streamSize);
    }

    async readStreamByPath(input: RandomAccessSource, headerInfo: HeaderInfo, path: string[]): Promise<Buffer | null> {
        const node = this.findByPath(path);

        if (!node) return null;
        return this.readStreamBySid(input, headerInfo, node.sid);
    }

    async readStreamChunksByPath(
        input: RandomAccessSource,
        headerInfo: HeaderInfo,
        path: string[],
    ): Promise<AsyncIterable<Buffer> | null> {
        const node = this.findByPath(path);
        if (!node || node.type !== DirectoryEntryType.Stream) return null;

        if (node.streamSize === 0) {
            return (async function* () {})();
        }
        if (
            node.startingSectorLocation === this.cfbConstants.END_OF_CHAIN ||
            node.startingSectorLocation === this.cfbConstants.FREE_SECTOR
        ) {
            throw new CorruptedSectorChainError(
                `Corrupted stream "${node.name}": size=${node.streamSize}, sector=${node.startingSectorLocation}`
            );
        }

        if (node.streamSize < headerInfo.miniStreamCutoffSize) {
            await this.initializeMiniStream(input, headerInfo);
            const data = await this.miniStreamReader!.readMiniStream({
                startingSectorLocation: node.startingSectorLocation,
                streamSize: node.streamSize,
            });
            return (async function* () { yield data; })();
        }

        return this.fatReader!.readChainChunks(
            input,
            node.startingSectorLocation,
            headerInfo,
            node.streamSize,
        );
    }
}

export function DirectoryReaderFactory(resolver: Resolver): DirectoryReader {
    const fatReader = resolver.get(TOKENS.fatReader);
    const miniFATFactory = resolver.get(TOKENS.miniFATReader);
    const miniStreamFactory = resolver.get(TOKENS.miniStreamReader);
    const cfbConstants = resolver.get(TOKENS.cfbfConstants);
    return new DirectoryReader(fatReader, miniFATFactory, miniStreamFactory, cfbConstants);
}

