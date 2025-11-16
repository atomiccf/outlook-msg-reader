import { setupContainer } from './di/setup';
import { container } from './di/container';
import type { HeaderReader } from './readers/headerReader';
import type { FATReader } from './readers/fatReader';
import type { HeaderInfo, Msg, MsgBody, MsgAttachment, DirectoryNode } from './types';
import { DirectoryReader } from './readers/directoryReader';
setupContainer();

export async function parseMsg(filePath: string): Promise<Msg> {
    console.info('[parseMsg] start:', filePath);
    const { headerInfo, getDirectoryTree, readStreamByPath } = await loadDirectory(filePath);
    console.info('[parseMsg] directory loaded. sectorSize:', headerInfo.sectorSize, 'miniSectorSize:', headerInfo.miniSectorSize);

    const readUnicodeString = async (path: string[]): Promise<string | undefined> => {
        const buf = await readStreamByPath(path);
        if (!buf) return undefined;
        // UTF-16LE, trim trailing nulls
        let s = buf.toString('utf16le');
        s = s.replace(/\u0000+$/g, '');
        return s.length ? s : undefined;
    };
    const readBinary = async (path: string[]): Promise<Buffer | undefined> => {
        const buf = await readStreamByPath(path);
        return buf ?? undefined;
    };

    // Common MSG streams on root
    const subject = await readUnicodeString(['Root Entry', '__substg1.0_0037001F'])
        ?? await readUnicodeString(['Root Entry', '__substg1.0_0037001E']); // fallback ANSI decoded as UTF-16LE may be messy

    const bodyText = await readUnicodeString(['Root Entry', '__substg1.0_1000001F'])
        ?? await readUnicodeString(['Root Entry', '__substg1.0_1000001E']);

    const html = await readUnicodeString(['Root Entry', '__substg1.0_1013001F'])
        ?? await readUnicodeString(['Root Entry', '__substg1.0_1013001E']);

    // RTF is compressed usually in 0x1009 (0102 type). Keep as buffer for now.
    const rtfCompressed = await readBinary(['Root Entry', '__substg1.0_10090102']);

    const senderName = await readUnicodeString(['Root Entry', '__substg1.0_0C1A001F'])
        ?? await readUnicodeString(['Root Entry', '__substg1.0_0042001F']); // PR_SENT_REPRESENTING_NAME alt
    const senderEmail = await readUnicodeString(['Root Entry', '__substg1.0_0C1F001F'])
        ?? await readUnicodeString(['Root Entry', '__substg1.0_0065001F']); // PR_SENT_REPRESENTING_EMAIL_ADDRESS alt

    // Minimal body object
    const body: MsgBody = {
        text: bodyText,
        html,
        rtf: rtfCompressed ? undefined : undefined
    };

    // Attachments are parsed by a separate helper below
    const attachments = await readAttachments(getDirectoryTree, readStreamByPath);
    console.info('[parseMsg] attachments count:', attachments.length);

    return {
        subject: subject ?? '',
        from: { name: senderName ?? '', email: senderEmail ?? '' },
        to: [],
        body,
        attachments
    };
}

/**
 * Low-level CFBF directory loader and stream accessors
 */
export async function loadDirectory(filePath: string): Promise<{
    headerInfo: HeaderInfo,
    tree: DirectoryNode | null,
    getDirectoryTree: () => DirectoryNode | null,
    readStreamByPath: (path: string[]) => Promise<Buffer | null>,
    readStreamBySid: (sid: number) => Promise<Buffer>
}> {
    console.info('[loadDirectory] reading header:', filePath);
    const headerReaderFactory = container.resolve<() => HeaderReader>('headerReaderFactory');
    const fatReaderFactory = container.resolve<() => FATReader>('fatReaderFactory');
    const directoryReaderFactory = container.resolve<() => DirectoryReader>('directoryReaderFactory');
    const headerReader = headerReaderFactory();
    const { header, stream } = await headerReader.readHeaderWithStream(filePath);

    const headerInfo: HeaderInfo = {
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

    const fatReader = fatReaderFactory();
    console.info('[loadDirectory] building FAT table...');
    // Use file path for random access reads to avoid stream seek issues
    await fatReader.buildTable(filePath, headerInfo);

    const dirReader = directoryReaderFactory();
    console.info('[loadDirectory] loading directory sectors...');
    await dirReader.loadDirectory(filePath, headerInfo);
    console.info('[loadDirectory] directory tree ready.');

    return {
        headerInfo,
        tree: dirReader.getTree(),
        getDirectoryTree: () => dirReader.getTree(),
        readStreamByPath: async (path: string[]) => dirReader.readStreamByPath(filePath, headerInfo, path),
        readStreamBySid: async (sid: number) => dirReader.readStreamBySid(filePath, headerInfo, sid)
    };
}

// Helpers for attachments
async function readAttachments(
    getDirectoryTree: () => DirectoryNode | null,
    readStreamByPath: (path: string[]) => Promise<Buffer | null>
): Promise<MsgAttachment[]> {
    const tree = getDirectoryTree();
    if (!tree) return [];

    const attachments: MsgAttachment[] = [];

    const visit = (node: DirectoryNode) => {
        if (node.name.startsWith('__attach_version1.0')) {
            // Streams inside attachment storage
            attachments.push({ name: '', mime: '', content: Buffer.alloc(0) });
        }
        node.children.forEach(visit);
    };
    visit(tree);

    // Fill attachment details by probing typical streams
    for (let i = 0; i < attachments.length; i++) {
        const idx = pad2(i);
        const storageName = `__attach_version1.0_${idx}`;
        const data =
            (await readStreamByPath(['Root Entry', storageName, '__substg1.0_37010102'])) ??
            (await readStreamByPath(['Root Entry', storageName, '__substg1.0_3701000D'])); // embedded msg as storage, ignore here

        const longNameBuf = await readStreamByPath(['Root Entry', storageName, '__substg1.0_3707001F']);
        const shortNameBuf = await readStreamByPath(['Root Entry', storageName, '__substg1.0_3704001F']);
        const mimeBuf = await readStreamByPath(['Root Entry', storageName, '__substg1.0_370E001F']);

        const name = bufToUnicode(longNameBuf) ?? bufToUnicode(shortNameBuf) ?? `attachment_${i + 1}`;
        const mime = bufToUnicode(mimeBuf) ?? 'application/octet-stream';

        attachments[i] = {
            name,
            mime,
            content: data ?? Buffer.alloc(0)
        };
    }

    return attachments;
}

function bufToUnicode(buf: Buffer | null): string | undefined {
    if (!buf) return undefined;
    let s = buf.toString('utf16le');
    s = s.replace(/\u0000+$/g, '');
    return s || undefined;
}

function pad2(n: number): string {
    const s = String(n);
    return s.length === 1 ? '0' + s : s;
}
