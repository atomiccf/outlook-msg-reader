import { container}  from './di/container';
import type { HeaderReader } from './readers/headerReader';
import type { FATReader } from './readers/fatReader';
import { Decoder, type SupportedCodePage } from './encoding/decoder';
import type { HeaderInfo, Msg, MsgBody, MsgAttachment, DirectoryNode } from './types';
import { DirectoryReader } from './readers/directoryReader';


export async function parseMsg(filePath: string): Promise<Msg> {
    console.info('[parseMsg] start:', filePath);
    const { headerInfo, getDirectoryTree, readStreamByPath } = await loadDirectory(filePath);
    console.info('[parseMsg] directory loaded. sectorSize:', headerInfo.sectorSize, 'miniSectorSize:', headerInfo.miniSectorSize);
    const decoder = container.get<Decoder>('decoder');

    // Cache codepage to avoid reading it multiple times
    let cachedCodepage: SupportedCodePage | null = null;
    const getCodepage = async (): Promise<SupportedCodePage> => {
        if (cachedCodepage !== null) {
            return cachedCodepage;
        }
        // Read PR_MESSAGE_CODEPAGE property (__substg1.0_3FFD001E)
        const codepageBuf = await readStreamByPath(['Root Entry', '__substg1.0_3FFD001E']);
        if (codepageBuf && codepageBuf.length >= 4) {
            // Read 32-bit little-endian integer
            const codepageValue = codepageBuf.readUInt32LE(0);
            // Validate that it's a supported codepage, fallback to 1252 if not
            const supportedCodepages: SupportedCodePage[] = [1250, 1251, 1252, 1253, 1254, 1255, 1256, 1257, 1258];
            if (supportedCodepages.includes(codepageValue as SupportedCodePage)) {
                cachedCodepage = codepageValue as SupportedCodePage;
            } else {
                cachedCodepage = 1252; // Default to Windows-1252
            }
        } else {
            // Default codepage if property is not found
            cachedCodepage = 1252;
        }
        return cachedCodepage;
    };

    const readUnicodeString = async (path: string[]): Promise<string | undefined> => {
        const buf = await readStreamByPath(path);
        if (!buf || buf.length === 0) {
            return undefined;
        }

        const prop = path[1].slice(-4);

        if (prop === "001F") {
            // UTF-16
            const result = buf
                .toString("utf16le")
                .replace(/\u0000+$/g, '');
            return result || undefined;
        }

        if (prop === "001E") {
            // Codepage ANSI - determine automatically from message codepage property
            const codepage = await getCodepage();
            const decoded = decoder.decodeBytes(buf, codepage);
            // Remove null bytes and trim, return undefined if empty
            const cleaned = decoded.replace(/\u0000+$/g, '').trim();
            return cleaned || undefined;
        }

        // Unknown property type, return undefined
        return undefined;
    };
    const readBinary = async (path: string[]): Promise<Buffer | undefined> => {
        const buf = await readStreamByPath(path);
        return buf ?? undefined;
    };

    // Common MSG streams on root
    const subject = await readUnicodeString(['Root Entry', '__substg1.0_0037001F'])
        ?? await readUnicodeString(['Root Entry', '__substg1.0_0037001E']); // fallback ANSI decoded as UTF-16LE may be messy

    // Helper to read string from binary property (0102 type)
    const readStringFromBinary = async (path: string[]): Promise<string | undefined> => {
        const buf = await readStreamByPath(path);
        if (!buf || buf.length === 0) {
            return undefined;
        }
        try {
            // Check for UTF-16 LE BOM (0xFF 0xFE)
            if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
                const result = buf.slice(2).toString('utf16le').replace(/\u0000+$/g, '').trim();
                return result || undefined;
            }
            // Check for UTF-16 BE BOM (0xFE 0xFF)
            if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
                // Convert BE to LE by swapping bytes
                const leBuf = Buffer.alloc(buf.length - 2);
                for (let i = 2; i < buf.length; i += 2) {
                    if (i + 1 < buf.length) {
                        leBuf[i - 2] = buf[i + 1];
                        leBuf[i - 1] = buf[i];
                    }
                }
                const result = leBuf.toString('utf16le').replace(/\u0000+$/g, '').trim();
                return result || undefined;
            }
            // Check for UTF-8 BOM (0xEF 0xBB 0xBF)
            if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
                const result = buf.slice(3).toString('utf8').replace(/\u0000+$/g, '').trim();
                return result || undefined;
            }
            // Try UTF-8 (most common for HTML in binary format)
            const utf8Result = buf.toString('utf8').replace(/\u0000+$/g, '').trim();
            // Validate UTF-8 - if it contains valid HTML-like content, use it
            if (utf8Result && (utf8Result.includes('<') || utf8Result.length > 10)) {
                return utf8Result || undefined;
            }
            // Fallback to UTF-16LE (common in MSG files)
            const utf16Result = buf.toString('utf16le').replace(/\u0000+$/g, '').trim();
            return utf16Result || undefined;
        } catch {
            return undefined;
        }
    };

    // Try to read body text (PR_BODY, property tag 0x1000)
    // Try alternative property tag 0x8010 first (some clients use this)
    let bodyText = await readUnicodeString(['Root Entry', '__substg1.0_8010001F'])
        ?? await readUnicodeString(['Root Entry', '__substg1.0_8010001E'])
        ?? await readUnicodeString(['Root Entry', '__substg1.0_1000001F'])
        ?? await readUnicodeString(['Root Entry', '__substg1.0_1000001E']);

    // Try to read HTML body (PR_HTML, property tag 0x1013)
    // Try PT_BINARY format (0102) first, then PT_UNICODE (001F), then PT_STRING8 (001E)
    let html = await readStringFromBinary(['Root Entry', '__substg1.0_10130102'])
        ?? await readUnicodeString(['Root Entry', '__substg1.0_1013001F'])
        ?? await readUnicodeString(['Root Entry', '__substg1.0_1013001E']);

    // Debug: log what we found and list available properties if body is missing
    if (!bodyText && !html) {
        console.warn('[parseMsg] Body not found. Listing available properties in Root Entry...');
        const tree = getDirectoryTree();
        if (tree) {
            // Find Root Entry node
            const findRootEntry = (node: DirectoryNode): DirectoryNode | null => {
                if (node.name === 'Root Entry') return node;
                for (const child of node.children) {
                    const found = findRootEntry(child);
                    if (found) return found;
                }
                return null;
            };
            const rootEntry = findRootEntry(tree);
            if (rootEntry) {
                const bodyProperties = rootEntry.children
                    .filter(child => child.name.startsWith('__substg1.0_') &&
                            (child.name.includes('1000') || child.name.includes('1013')))
                    .map(child => child.name);
                if (bodyProperties.length > 0) {
                    console.info(`[parseMsg] Found body-related properties: ${bodyProperties.join(', ')}`);
                } else {
                    const allProperties = rootEntry.children
                        .filter(child => child.name.startsWith('__substg1.0_'))
                        .map(child => child.name)
                        .slice(0, 20); // Limit to first 20 for readability
                    console.info(`[parseMsg] Available properties (first 20): ${allProperties.join(', ')}`);
                }
            }
        }
    }

    // RTF is compressed usually in 0x1009 (0102 type). Keep as buffer for now.
    const rtfCompressed = await readBinary(['Root Entry', '__substg1.0_10090102']);

    const senderName = await readUnicodeString(['Root Entry', '__substg1.0_0C1A001F'])
        ?? await readUnicodeString(['Root Entry', '__substg1.0_0042001F']); // PR_SENT_REPRESENTING_NAME alt
    const senderEmail = await readUnicodeString(['Root Entry', '__substg1.0_0C1F001F'])
        ?? await readUnicodeString(['Root Entry', '__substg1.0_0065001F']); // PR_SENT_REPRESENTING_EMAIL_ADDRESS alt

    // Minimal body object
    const body: MsgBody = {
        ...(bodyText && { text: bodyText }),
        ...(html && { html }),
        ...(rtfCompressed && { rtf: undefined }) // RTF is compressed, needs decompression
    };
    console.info('[parseMsg] body:', JSON.stringify(body, null, 2));
    console.info('[parseMsg] bodyText found:', !!bodyText, 'html found:', !!html);
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
