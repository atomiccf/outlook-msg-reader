import { Decoder } from '../encoding/decoder';
import { CFBFReader, CFBFReaderFactory } from '../сfb/CFBReader';
import { container } from '../di/container';
import type { Msg, MsgBody, DirectoryNode } from '../types';
import { createCodePageReader, type CodePageReader } from './CodePageReader';
import { createPropertyReader, type PropertyReader } from './PropertyReader';
import { createAttachmentReader, type AttachmentReader } from './AttachmentReader';
import { createNamedPropertyReader, type NamedPropertyReader } from './NamedPropertyReader';

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
     * @param namedPropertyReader - Reader for named properties
     * @param decoder
     */
    private constructor(
        private readonly cfbReader: CFBFReader,
        private readonly codePageReader: CodePageReader,
        private readonly propertyReader: PropertyReader,
        private readonly attachmentReader: AttachmentReader,
        private readonly namedPropertyReader: NamedPropertyReader,
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
        const tree = cfbReader.getTree();
        if (tree) {
            console.log('[CFBF] Directory tree structure:');
            console.log(`  Root: ${tree.name} (sid: ${tree.sid}, type: 0x${tree.type.toString(16)})`);
            console.log(`  Children count: ${tree.children.length}`);
            if (tree.children.length > 0) {
                console.log(`  First 10 children:`, tree.children.slice(0, 10).map(c =>
                    `${c.name} (sid: ${c.sid}, type: 0x${c.type.toString(16)}, size: ${c.streamSize})`
                ));
            }
        }
        // Build dependency chain using local factories
        const codePageReader = createCodePageReader(cfbReader);
        const propertyReader = createPropertyReader(cfbReader, decoder, codePageReader);
        const attachmentReader = createAttachmentReader(cfbReader, propertyReader);
        const namedPropertyReader = createNamedPropertyReader(cfbReader, decoder, codePageReader);
        
        // Initialize named property reader
        await namedPropertyReader.initialize();

        return new MsgReader(cfbReader, codePageReader, propertyReader, attachmentReader, namedPropertyReader, decoder);
    }

    /**
     * For testing: create MsgReader with custom dependencies
     */
    static fromDependencies(
        cfbReader: CFBFReader,
        codePageReader: CodePageReader,
        propertyReader: PropertyReader,
        attachmentReader: AttachmentReader,
        namedPropertyReader: NamedPropertyReader,
        decoder:Decoder
    ): MsgReader {
        return new MsgReader(cfbReader, codePageReader, propertyReader, attachmentReader, namedPropertyReader, decoder);
    }

    /**
     * Parses the entire MSG file and returns a Msg object.
     */
    async parse(): Promise<Msg> {
        // Read subject
        const subject = await this.getSubject();

        // Read body using getBody() method
        const body = await this.getBody();

        // Read sender information using getFrom() method
        const from = await this.getFrom();

        // Debug: log what we found and list available properties if body is missing
        if (!body.text && !body.html) {
            this.logBodyNotFound();
        }

        // Read recipients
        const recipients = await this.getRecipients();

        // Read attachments
        const attachments = await this.attachmentReader.readAttachments();

        return {
            subject: subject ?? '',
            from,
            to: recipients.to,
            cc: recipients.cc,
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
            for (const path of subjectPaths) {
                const fullPath = Array.isArray(path) ? path : [path];

                try {
                    const unicode = await this.propertyReader.readUnicodeString(fullPath);
                    if (unicode?.trim()) return unicode.trim();

                    const ansi = await this.propertyReader.readStringFromBinary(fullPath);
                    if (ansi?.trim()) return ansi.trim();
                } catch {
                    // Continue to next path if this one fails
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
                console.log('headers', headers)
                headers = headers.replace(/\r?\n[ \t]+/g, ' ');


                const match = headers.match(/^Subject:\s*(.+)$/im);
                if (match) {
                    const fullEncoded = match[1].trim();
                    return this.decoder.decodeRFC2047(fullEncoded);

                }
            }
        } catch {
            // Headers not found or error reading - continue without headers fallback
        }

        return '';
    }
    /**
     * Gets the body of the message (text, HTML, RTF).
     * Checks nativeBody property to determine which format is primary.
     */
    async getBody(): Promise<MsgBody> {
        // First check nativeBody to see which format is used (1=plain text, 2=RTF, 3=HTML, 4=HTML and RTF)
        // Note: nativeBody is read but not used for prioritization - we try all formats anyway
        await this.readPropertyByTag(['1017'], false, false);

        const body: MsgBody = {};

        // Read text body (PR_BODY, tag 0x1000)
        // Try standard PR_BODY (0x1000) first
        let text = await this.readPropertyByTag(['1000'], false) as string | undefined;
        
        // Validate that it's actually body text and not a Message-ID or other identifier
        if (!text || !this.isValidBodyText(text)) {
            // If 0x1000 is invalid or missing, try named property 0x8010 as fallback
            const fallbackText = await this.readPropertyByTag(['8010'], false) as string | undefined;
            if (fallbackText && this.isValidBodyText(fallbackText)) {
                text = fallbackText;
            } else {
                text = undefined; // Clear invalid text
            }
        }
        
        if (text) {
            body.text = text;
        }

        // Read HTML body (PR_HTML, tag 0x1013)
        // Can be stored as Unicode string (001F) or binary (0102)
        const htmlBinary = await this.readPropertyByTag(['1013'], true) as string | Buffer | undefined;
        if (htmlBinary) {
            if (typeof htmlBinary === 'string') {
                body.html = htmlBinary;
            } else if (Buffer.isBuffer(htmlBinary)) {
                // Try to decode binary HTML - usually UTF-8 or UTF-16
                try {
                    // Check for UTF-16 BOM
                    if (htmlBinary.length >= 2 && htmlBinary[0] === 0xFF && htmlBinary[1] === 0xFE) {
                        body.html = htmlBinary.subarray(2).toString('utf16le');
                    } else if (htmlBinary.length >= 2 && htmlBinary[0] === 0xFE && htmlBinary[1] === 0xFF) {
                        // UTF-16 BE - convert to LE
                        const leBuf = Buffer.alloc(htmlBinary.length - 2);
                        for (let i = 2; i < htmlBinary.length; i += 2) {
                            if (i + 1 < htmlBinary.length) {
                                leBuf[i - 2] = htmlBinary[i + 1];
                                leBuf[i - 1] = htmlBinary[i];
                            }
                        }
                        body.html = leBuf.toString('utf16le');
                    } else {
                        // Try UTF-8 first (most common for HTML)
                        const utf8Result = htmlBinary.toString('utf8');
                        // Validate it looks like HTML
                        if (utf8Result.includes('<') && utf8Result.includes('>')) {
                            body.html = utf8Result;
                        } else {
                            // Fallback to UTF-16
                            body.html = htmlBinary.toString('utf16le').replace(/\0+$/g, '');
                        }
                    }
                } catch (error) {
                    console.log(`[MsgReader] Error decoding HTML binary:`, error);
                    // Continue without HTML body
                }
            }
        }

        // Read RTF body (PR_RTF_COMPRESSED, tag 0x1009) - stored as binary
        const rtf = await this.readPropertyByTag(['1009'], true) as Buffer | undefined;
        if (rtf && Buffer.isBuffer(rtf) && rtf.length > 0) {
            // RTF requires decompression (LZFU algorithm) - not implemented
            // Leave it undefined for now
            body.rtf = undefined;
        }

        return body;
    }

    async getFrom(): Promise<{ name: string; email: string }> {
        const senderName = await this.readPropertyByTag(['0C1A', '0042']) as string | undefined;
        const senderEmail = await this.readPropertyByTag(['0C1F', '0065']) as string | undefined;

        return {
            name: senderName ?? '',
            email: senderEmail ?? ''
        };
    }

    /**
     * Gets all recipients (To, CC, BCC) from the message.
     * Reads from both individual recipient storage nodes and display properties.
     */
    async getRecipients(): Promise<{
        to: Array<{ name: string; email: string }>;
        cc?: Array<{ name: string; email: string }>;
        bcc?: Array<{ name: string; email: string }>;
    }> {
        const tree = this.cfbReader.getTree();
        if (!tree) {
            return { to: [] };
        }

        // Find all recipient storage nodes
        const recipientStorageNodes: string[] = [];
        const findRecipientNodes = (node: DirectoryNode) => {
            if (node.name.startsWith('__recip_version1.0_')) {
                recipientStorageNodes.push(node.name);
            }
            node.children.forEach(findRecipientNodes);
        };
        findRecipientNodes(tree);

        const to: Array<{ name: string; email: string }> = [];
        const cc: Array<{ name: string; email: string }> = [];
        const bcc: Array<{ name: string; email: string }> = [];

        // Read individual recipients from storage nodes
        for (const storageName of recipientStorageNodes) {
            try {
                const recipientTypeBuf = await this.cfbReader.readStream(['Root Entry', storageName, '__substg1.0_0C150003']);
                const recipientType = recipientTypeBuf ? recipientTypeBuf.readUInt32LE(0) : undefined;

                // Read recipient name (try multiple property IDs)
                const displayName = await this.readRecipientProperty(storageName, ['3001', '39FE']) as string | undefined;
                const recipientName = await this.readRecipientProperty(storageName, ['39FE']) as string | undefined;
                const name = displayName || recipientName || '';

                // Read recipient email
                const email = await this.readRecipientProperty(storageName, ['39FF', '0C1F']) as string | undefined || '';

                if (name || email) {
                    const recipient = { name, email };
                    // RecipientType: 1=TO, 2=CC, 3=BCC
                    if (recipientType === 1) {
                        to.push(recipient);
                    } else if (recipientType === 2) {
                        cc.push(recipient);
                    } else if (recipientType === 3) {
                        bcc.push(recipient);
                    } else {
                        // Default to TO if type is unknown
                        to.push(recipient);
                    }
                }
            } catch (error) {
                console.log(`[MsgReader] Error reading recipient from ${storageName}:`, error);
            }
        }

        // If no recipients found from storage nodes, try display properties
        if (to.length === 0 && cc.length === 0 && bcc.length === 0) {
            const displayTo = await this.readPropertyByTag(['0E04']) as string | undefined;
            const displayCc = await this.readPropertyByTag(['0E03']) as string | undefined;
            const displayBcc = await this.readPropertyByTag(['0E02']) as string | undefined;

            // Parse comma-separated display strings (simple parsing)
            if (displayTo && typeof displayTo === 'string') {
                const toList = this.parseDisplayRecipients(displayTo);
                to.push(...toList);
            }
            if (displayCc && typeof displayCc === 'string') {
                const ccList = this.parseDisplayRecipients(displayCc);
                cc.push(...ccList);
            }
            if (displayBcc && typeof displayBcc === 'string') {
                const bccList = this.parseDisplayRecipients(displayBcc);
                bcc.push(...bccList);
            }
        }

        const result: {
            to: Array<{ name: string; email: string }>;
            cc?: Array<{ name: string; email: string }>;
            bcc?: Array<{ name: string; email: string }>;
        } = { to };

        if (cc.length > 0) result.cc = cc;
        if (bcc.length > 0) result.bcc = bcc;

        return result;
    }

    /**
     * Reads a property from a recipient storage node.
     */
    private async readRecipientProperty(
        storageName: string,
        propertyIds: string[]
    ): Promise<string | undefined> {
        for (const propertyId of propertyIds) {
            // Try Unicode (001F)
            const unicode = await this.propertyReader.readUnicodeString([
                'Root Entry',
                storageName,
                `__substg1.0_${propertyId.toUpperCase().padStart(4, '0')}001F`
            ]);
            if (unicode?.trim()) return unicode.trim();

            // Try ANSI (001E)
            const ansi = await this.propertyReader.readStringFromBinary([
                'Root Entry',
                storageName,
                `__substg1.0_${propertyId.toUpperCase().padStart(4, '0')}001E`
            ]);
            if (ansi?.trim()) return ansi.trim();

            // Try binary as string (0102)
            const fromBinary = await this.propertyReader.readStringFromBinary([
                'Root Entry',
                storageName,
                `__substg1.0_${propertyId.toUpperCase().padStart(4, '0')}0102`
            ]);
            if (fromBinary?.trim()) return fromBinary.trim();
        }
        return undefined;
    }

    /**
     * Parses a display recipients string (e.g., "John Doe <john@example.com>; Jane Doe <jane@example.com>")
     * into an array of recipient objects.
     */
    private parseDisplayRecipients(displayString: string): Array<{ name: string; email: string }> {
        const recipients: Array<{ name: string; email: string }> = [];
        
        // Ensure we have a string
        if (!displayString || typeof displayString !== 'string') {
            return recipients;
        }
        
        // Split by semicolon
        const parts = displayString.split(';').map(s => s.trim()).filter(s => s);
        
        for (const part of parts) {
            // Try to parse "Name <email>" format
            const match = part.match(/^(.+?)\s*<(.+?)>$/);
            if (match) {
                recipients.push({
                    name: match[1].trim(),
                    email: match[2].trim()
                });
            } else if (part.includes('@')) {
                // If it contains @, treat as email only
                recipients.push({
                    name: '',
                    email: part.trim()
                });
            } else {
                // Otherwise treat as name only
                recipients.push({
                    name: part.trim(),
                    email: ''
                });
            }
        }
        
        return recipients;
    }

    /**
     * Validates if a string is likely a real message body text and not a Message-ID or other identifier.
     * Filters out strings that look like Message-IDs (wrapped in <>) or other identifiers.
     */
    private isValidBodyText(text: string): boolean {
        if (!text || typeof text !== 'string') {
            return false;
        }

        const trimmed = text.trim();

        // Empty or very short strings are not valid body text
        if (trimmed.length < 3) {
            return false;
        }

        // Check if it looks like a Message-ID (starts and ends with < and contains @)
        // Message-IDs typically look like: <someid@domain.com> or <BYAPR06MB4968E33F4D4F41368EF65C7FAEDFA@...>
        if (trimmed.startsWith('<') && trimmed.endsWith('>') && trimmed.includes('@')) {
            // This looks like a Message-ID, not body text
            // However, check if it's a very long string that might be actual content
            // Message-IDs are usually < 100 characters
            if (trimmed.length < 100) {
                return false;
            }
            // If it's longer, it might be content with angle brackets
        }

        // Check if it's just an email address pattern (single line with @)
        const emailPattern = /^[^\s]+@[^\s]+\.[^\s]+$/;
        if (emailPattern.test(trimmed) && trimmed.length < 100) {
            return false;
        }

        // If text contains multiple lines or spaces, it's more likely to be real body text
        if (trimmed.includes('\n') || trimmed.includes(' ') || trimmed.length > 50) {
            return true;
        }

        // For short single-line text, be more permissive but reject obvious identifiers
        return true;
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

        // Find Root Entry node (it might be the root itself)
        const findRootEntry = (node: DirectoryNode): DirectoryNode | null => {
            if (node.name === 'Root Entry') return node;
            for (const child of node.children) {
                const found = findRootEntry(child);
                if (found) return found;
            }
            return null;
        };

        // Collect all properties recursively from a node and all its children (including Storage nodes)
        const collectProperties = (node: DirectoryNode, properties: string[] = []): string[] => {
            // Only collect Stream nodes (type === DirectoryEntryType.Stream = 0x02)
            if (node.type === 0x02 && node.name.startsWith('__substg1.0_')) {
                properties.push(node.name);
            }
            for (const child of node.children) {
                collectProperties(child, properties);
            }
            return properties;
        };

        const rootEntry = tree.name === 'Root Entry' ? tree : findRootEntry(tree);
        if (rootEntry) {
            // Collect all properties recursively from Root Entry and all its children (including Storage nodes)
            const allProperties = collectProperties(rootEntry);

            const bodyProperties = allProperties.filter(name =>
                name.includes('1000') || name.includes('1013')
            );

            if (bodyProperties.length > 0) {
                console.info(`[MsgReader] Found body-related properties: ${bodyProperties.join(', ')}`);
            } else {
                const first20 = allProperties.slice(0, 20);
                if (first20.length > 0) {
                    console.info(`[MsgReader] Available properties (first 20): ${first20.join(', ')}`);
                } else {
                    console.info(`[MsgReader] No properties found. Root Entry has ${rootEntry.children.length} direct children.`);
                    if (rootEntry.children.length > 0) {
                        const childNames = rootEntry.children.map(c => `${c.name} (type: 0x${c.type.toString(16)})`).slice(0, 10);
                        console.info(`[MsgReader] Root Entry children (first 10): ${childNames.join(', ')}`);
                    }
                }
            }
        } else {
            console.info(`[MsgReader] Root Entry not found. Root node name: ${tree.name}`);
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

    private findPropertyPaths(propertyIds: string[], node: DirectoryNode, path: string[] = []): string[][] {
        const results: string[][] = [];
        const currentPath = [...path, node.name];

        // Check if node is a Stream (type === 2) and has property name format
        if (node.type === 2 && node.name.startsWith('__substg1.0_')) {
            const tag = node.name.substring(12, 16); // Extract property ID (4 hex digits)
            if (propertyIds.some(id => tag.toUpperCase() === id.toUpperCase())) {
                results.push(currentPath);
            }
        }

        for (const child of node.children) {
            results.push(...this.findPropertyPaths(propertyIds, child, currentPath));
        }
        return results;
    }

    /**
     * Reads a property by tag ID, trying all property types automatically.
     * Also checks named properties as fallback.
     * 
     * @param propertyIds - Array of property IDs to try (e.g., ['1000', '8010'])
     * @param preferBinary - If true, prefer binary format; otherwise prefer string formats
     * @param tryAllTypes - If true, automatically try all property types (001F, 001E, 0102) for each ID
     * @returns Property value as string or Buffer, or undefined if not found
     */
    private async readPropertyByTag(
        propertyIds: string[], 
        preferBinary: boolean = false,
        tryAllTypes: boolean = true
    ): Promise<string | Buffer | undefined> {
        const tree = this.cfbReader.getTree();
        if (!tree) return undefined;

        // Property types to try in order
        const PROPERTY_TYPES = ['001F', '001E', '0102']; // Unicode, ANSI, Binary

        // First, try to find properties by exact paths (with all types if tryAllTypes is true)
        for (const propertyId of propertyIds) {
            const typesToTry = tryAllTypes ? PROPERTY_TYPES : [preferBinary ? '0102' : '001F'];
            
            for (const propType of typesToTry) {
                // Try exact path first
                const exactPath = ['Root Entry', `__substg1.0_${propertyId.toUpperCase().padStart(4, '0')}${propType}`];
                try {
                    const result = await this.tryReadProperty(exactPath, preferBinary);
                    if (result !== undefined) {
                        return result;
                    }
                } catch {
                    // Continue to next attempt if this one fails
                }
            }
        }

        // Then try recursive search for all property IDs
        const paths = this.findPropertyPaths(propertyIds, tree);

        if (paths.length > 0) {
            console.log(`[MsgReader] Found ${paths.length} path(s) for property IDs ${propertyIds.join(', ')}:`, paths);

            for (const path of paths) {
                try {
                    const result = await this.tryReadProperty(path, preferBinary);
                    if (result !== undefined) {
                        return result;
                    }
                } catch (error) {
                    console.log(`[MsgReader] Error reading property from path ${path.join(' -> ')}:`, error);
                    // Continue to next path
                }
            }
        }

        // If not found and we have named properties, try to resolve via named properties
        // Note: This would require knowing the GUID and name, which is complex
        // For now, we'll skip this but log it
        if (this.namedPropertyReader.hasNamedProperties()) {
            console.log(`[MsgReader] Named properties available but not used for IDs: ${propertyIds.join(', ')}`);
        }

        console.log(`[MsgReader] No paths found for property IDs: ${propertyIds.join(', ')}`);
        return undefined;
    }

    /**
     * Tries to read a property from a path, attempting different reading methods.
     */
    private async tryReadProperty(path: string[], preferBinary: boolean): Promise<string | Buffer | undefined> {
        if (preferBinary) {
            const binary = await this.propertyReader.readBinary(path);
            if (binary && binary.length > 0) {
                console.log(`[MsgReader] Successfully read binary property from path: ${path.join(' -> ')}`);
                return binary;
            }
        }

        // Try unicode string
        const unicode = await this.propertyReader.readUnicodeString(path);
        if (unicode?.trim()) {
            console.log(`[MsgReader] Successfully read unicode property from path: ${path.join(' -> ')}`);
            return unicode;
        }

        // Try string from binary (handles various encodings)
        const fromBinary = await this.propertyReader.readStringFromBinary(path);
        if (fromBinary?.trim()) {
            console.log(`[MsgReader] Successfully read string from binary property from path: ${path.join(' -> ')}`);
            return fromBinary;
        }

        // If preferBinary is false and we haven't tried binary yet, try it
        if (!preferBinary) {
            const binary = await this.propertyReader.readBinary(path);
            if (binary && binary.length > 0) {
                console.log(`[MsgReader] Successfully read binary property from path: ${path.join(' -> ')}`);
                return binary;
            }
        }

        return undefined;
    }

}

