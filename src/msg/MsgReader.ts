import { Decoder } from '../encoding/decoder';
import { CFBFReader, CFBFReaderFactory } from '../сfb/CFBReader';
import { container } from '../di/container';
import type { Msg, MsgBody, DirectoryNode } from '../types';
import { createCodePageReader, type CodePageReader } from './CodePageReader';
import { createPropertyReader, type PropertyReader } from './PropertyReader';
import { createAttachmentReader, type AttachmentReader } from './AttachmentReader';

/**
 * Main reader class for parsing MSG files.
 * Uses constructor injection for testability and explicit dependencies.
 */
export class MsgReader {
    /**
     * @param cfbReader - CFBF file reader
     * @param codePageReader - Reader for message codepage
     * @param propertyReader - Reader for MSG properties
     * @param attachmentReader - Reader for attachments
     * @param decoder
     */
    private constructor(
        private readonly cfbReader: CFBFReader,
        private readonly codePageReader: CodePageReader,
        private readonly propertyReader: PropertyReader,
        private readonly attachmentReader: AttachmentReader,
        private readonly decoder:Decoder
    ) {}

    /**
     * Factory method to create MsgReader from a file path.
     * Constructs all dependencies and wires them together.
     *
     * @param filePath - Path to .msg file
     */
    static async fromFile(filePath: string): Promise<MsgReader> {
        // Get global dependencies from container
        const decoder = container.get<Decoder>('decoder');

        // Create CFBFReader for this file
        const cfbReader = CFBFReaderFactory();
        await cfbReader.load(filePath);

        // Build dependency chain using local factories
        const codePageReader = createCodePageReader(cfbReader);
        const propertyReader = createPropertyReader(cfbReader, decoder, codePageReader);
        const attachmentReader = createAttachmentReader(cfbReader, propertyReader);

        return new MsgReader(cfbReader, codePageReader, propertyReader, attachmentReader,decoder);
    }

    /**
     * For testing: create MsgReader with custom dependencies
     */
    static fromDependencies(
        cfbReader: CFBFReader,
        codePageReader: CodePageReader,
        propertyReader: PropertyReader,
        attachmentReader: AttachmentReader,
        decoder:Decoder
    ): MsgReader {
        return new MsgReader(cfbReader, codePageReader, propertyReader, attachmentReader,decoder);
    }

    /**
     * Parses the entire MSG file and returns a Msg object.
     */
    async parse(): Promise<Msg> {
        // Read subject
        const subject = await this.getSubject();
        const getBody = await this.getBody();
        // Read body text (PR_BODY, property tag 0x1000)
        // Try alternative property tag 0x8010 first (some clients use this)
        const bodyText = await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_8010001F'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_8010001E'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_1000001F'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_1000001E']);

        // Read HTML body (PR_HTML, property tag 0x1013)
        // Try PT_BINARY format (0102) first, then PT_UNICODE (001F), then PT_STRING8 (001E)
        const html = await this.propertyReader.readStringFromBinary(['Root Entry', '__substg1.0_10130102'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_1013001F'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_1013001E']);

        // Debug: log what we found and list available properties if body is missing
        if (!bodyText && !html) {
            this.logBodyNotFound();
        }

        // RTF is compressed usually in 0x1009 (0102 type). Keep as buffer for now.
        const rtfCompressed = await this.propertyReader.readBinary(['Root Entry', '__substg1.0_10090102']);

        // Read sender information
        const senderName = await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_0C1A001F'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_0042001F']); // PR_SENT_REPRESENTING_NAME alt
        const senderEmail = await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_0C1F001F'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_0065001F']); // PR_SENT_REPRESENTING_EMAIL_ADDRESS alt

        // Build body object
        const body: MsgBody = getBody;

        // Read attachments
        const attachments = await this.attachmentReader.readAttachments();

        return {
            subject: subject ?? '',
            from: { name: senderName ?? '', email: senderEmail ?? '' },
            to: [],
            body,
            attachments
        };
    }

    /**
     * Gets the subject of the message.
     */
    async getSubject(): Promise<string> {
        const tree = this.cfbReader.getTree();
        if (!tree) return '';

        const subjectPaths = this.findSubjectPaths(tree);
        if (subjectPaths.length) {
            // Основной цикл по путям
            for (const path of subjectPaths) {
                const fullPath = Array.isArray(path) ? path : [path];

                try {
                    const unicode = await this.propertyReader.readUnicodeString(fullPath);
                    if (unicode?.trim()) return unicode.trim();

                    const ansi = await this.propertyReader.readStringFromBinary(fullPath);
                    if (ansi?.trim()) return ansi.trim();
                } catch {
                }
            }
        }

         try {
            // Unicode version
            let headers = await this.propertyReader.readUnicodeString(['Root Entry','__substg1.0_007D001F']);
            if (!headers) {
                headers = await this.propertyReader.readUnicodeString(['Root Entry','__substg1.0_007D001E']);
            }

            if (headers) {

                headers = headers.replace(/\r?\n[ \t]+/g, ' ');


                const match = headers.match(/^Subject:\s*(.+)$/im);
                if (match) {
                    const fullEncoded = match[1].trim();
                    return this.decoder.decodeRFC2047(fullEncoded);

                }
            }
        } catch {
        }

        return '';
    }
    /**
     * Gets the body of the message (text, HTML, RTF).
     */
    async getBody(): Promise<MsgBody> {
        const ROOT = ['Root Entry'];

        const TEXT_TAGS = [
            '__substg1.0_8010001F', // PT_UNICODE, PR_BODY
            '__substg1.0_8010001E', // PT_STRING8, PR_BODY
            '__substg1.0_1000001F', // PT_UNICODE, PR_BODY
            '__substg1.0_1000001E'  // PT_STRING8, PR_BODY
        ];

        const HTML_TAGS = [
            '__substg1.0_10130102', // PT_BINARY, PR_HTML
            '__substg1.0_1013001F', // PT_UNICODE, PR_HTML
            '__substg1.0_1013001E'  // PT_STRING8, PR_HTML
        ];

        const RTF_TAGS = [
            '__substg1.0_10090102',
            '__substg1.0_1009010E'
        ];


        const readFirstAvailable = async (tags: string[]) => {
            for (const tag of tags) {
                try {
                    const unicode = await this.propertyReader.readUnicodeString([...ROOT, tag]);
                    if (unicode?.trim()) return unicode;

                    const binary = await this.propertyReader.readStringFromBinary([...ROOT, tag]);
                    if (binary?.trim()) return binary;
                } catch {
                    continue;
                }
            }
            return undefined;
        };

        const readBinary = async (tags: string[]) => {
            for (const tag of tags) {
                try {
                    const buf = await this.propertyReader.readBinary([...ROOT, tag]);
                    if (buf && buf.length) return buf;
                } catch {
                    continue;
                }
            }
            return undefined;
        };

        const [text, html, rtfCompressed] = await Promise.all([
            readFirstAvailable(TEXT_TAGS),
            readFirstAvailable(HTML_TAGS),
            readBinary(RTF_TAGS)
        ]);

        return {
            ...(text && { text }),
            ...(html && { html }),
            ...(rtfCompressed && { rtf: undefined }) // оставляем как Buffer, можно декомпрессировать позже
        };
    }

    /**
     * Gets the sender information.
     */
    async getFrom(): Promise<{ name: string; email: string }> {
        const senderName = await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_0C1A001F'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_0042001F']);
        const senderEmail = await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_0C1F001F'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_0065001F']);

        return { name: senderName ?? '', email: senderEmail ?? '' };
    }

    /**
     * Gets all attachments from the message.
     */
    async getAttachments() {
        return this.attachmentReader.readAttachments();
    }


    /**
     * Logs available properties when body is not found (for debugging).
     */
    private logBodyNotFound(): void {
        const tree = this.cfbReader.getTree();
        if (!tree) return;

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
                console.info(`[MsgReader] Found body-related properties: ${bodyProperties.join(', ')}`);
            } else {
                const allProperties = rootEntry.children
                    .filter(child => child.name.startsWith('__substg1.0_'))
                    .map(child => child.name)
                    .slice(0, 20); // Limit to first 20 for readability
                console.info(`[MsgReader] Available properties (first 20): ${allProperties.join(', ')}`);
            }
        }
    }

    private findSubjectPaths = (node: DirectoryNode, path: string[] = []): string[][] => {
        const results: string[][] = [];
        const currentPath = [...path, node.name];

        const SUBJECT_TAGS = new Set([
            '0037',  // PR_SUBJECT
            '0039',  // PR_SUBJECT_PREFIX  (Re:, Fw:)
            '0070',  // PR_CONVERSATION_TOPIC
            '0E1D',  // PR_NORMALIZED_SUBJECT
            '103E',  // PR_ORIGINAL_SUBJECT
            '1042',  // PR_ORIGINAL_SUBJECT_W (редко, но встречается)
        ]);

        if (node.type === 2 && node.name.startsWith('__substg1.0_')) {
            const tag = node.name.substring(12, 16);
            if (SUBJECT_TAGS.has(tag)) {
                results.push(currentPath);
            }
        }

        for (const child of node.children) {
            results.push(...this.findSubjectPaths(child, currentPath));
        }
        return results;
    };
}

