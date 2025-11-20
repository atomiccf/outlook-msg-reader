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
     */
    private constructor(
        private readonly cfbReader: CFBFReader,
        private readonly codePageReader: CodePageReader,
        private readonly propertyReader: PropertyReader,
        private readonly attachmentReader: AttachmentReader
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
        
        return new MsgReader(cfbReader, codePageReader, propertyReader, attachmentReader);
    }

    /**
     * For testing: create MsgReader with custom dependencies
     */
    static fromDependencies(
        cfbReader: CFBFReader,
        codePageReader: CodePageReader,
        propertyReader: PropertyReader,
        attachmentReader: AttachmentReader
    ): MsgReader {
        return new MsgReader(cfbReader, codePageReader, propertyReader, attachmentReader);
    }

    /**
     * Parses the entire MSG file and returns a Msg object.
     */
    async parse(): Promise<Msg> {
        // Read subject
        const subject = await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_0037001F'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_0037001E']);

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
        const body: MsgBody = {
            ...(bodyText && { text: bodyText }),
            ...(html && { html }),
            ...(rtfCompressed && { rtf: undefined }) // RTF is compressed, needs decompression
        };

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
        const subject = await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_0037001F'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_0037001E']);
        return subject ?? '';
    }

    /**
     * Gets the body of the message (text, HTML, RTF).
     */
    async getBody(): Promise<MsgBody> {
        const bodyText = await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_8010001F'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_8010001E'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_1000001F'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_1000001E']);

        const html = await this.propertyReader.readStringFromBinary(['Root Entry', '__substg1.0_10130102'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_1013001F'])
            ?? await this.propertyReader.readUnicodeString(['Root Entry', '__substg1.0_1013001E']);

        const rtfCompressed = await this.propertyReader.readBinary(['Root Entry', '__substg1.0_10090102']);

        return {
            ...(bodyText && { text: bodyText }),
            ...(html && { html }),
            ...(rtfCompressed && { rtf: undefined })
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
}

