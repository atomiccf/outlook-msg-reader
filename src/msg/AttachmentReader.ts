import type { MsgAttachment } from '../types';
import type { DirectoryNode } from '../types';
import type { CFBFReader } from '../сfb/CFBReader';
import type { PropertyReader } from './PropertyReader';
import { bufToUnicode, pad2 } from '../utils/utils';

/**
 * Reader for MSG file attachments.
 * Handles reading attachment data and metadata.
 */
export class AttachmentReader {
    constructor(
        private readonly cfbReader: CFBFReader,
        private readonly propertyReader: PropertyReader
    ) {}

    /**
     * Reads all attachments from the MSG file.
     */
    async readAttachments(): Promise<MsgAttachment[]> {
        const tree = this.cfbReader.getTree();
        if (!tree) return [];

        const attachments: MsgAttachment[] = [];

        // Find all attachment storage nodes
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
                (await this.cfbReader.readStream(['Root Entry', storageName, '__substg1.0_37010102'])) ??
                (await this.cfbReader.readStream(['Root Entry', storageName, '__substg1.0_3701000D'])); // embedded msg as storage, ignore here

            const longNameBuf = await this.cfbReader.readStream(['Root Entry', storageName, '__substg1.0_3707001F']);
            const shortNameBuf = await this.cfbReader.readStream(['Root Entry', storageName, '__substg1.0_3704001F']);
            const mimeBuf = await this.cfbReader.readStream(['Root Entry', storageName, '__substg1.0_370E001F']);

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
}

/**
 * Factory function to create AttachmentReader
 */
export function createAttachmentReader(
    cfbReader: CFBFReader,
    propertyReader: PropertyReader
): AttachmentReader {
    return new AttachmentReader(cfbReader, propertyReader);
}

