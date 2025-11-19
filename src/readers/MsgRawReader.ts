import type { RawAttachment } from '../types';
import type { CFBFReader } from '../сfb/CFBReader';
import { Decoder, type SupportedCodePage } from '../encoding/decoder';
import { container } from '../di/container';


export class MsgRawReader {
    private cachedCodepage: SupportedCodePage | null = null;
    private decoder:Decoder
    private cfbf:CFBFReader

    constructor(decoder:Decoder,cfbf:CFBFReader) {
        this.decoder = decoder
        this.cfbf = cfbf

    }

    async getProperty(path: string[]): Promise<Buffer | null> {
        return this.cfbf.readStream(path);
    }

    private async getCodepage(): Promise<SupportedCodePage> {
        if (this.cachedCodepage) return this.cachedCodepage;

        const buf = await this.getProperty(['Root Entry', '__substg1.0_3FFD001E']);
        if (buf && buf.length >= 4) {
            const val = buf.readUInt32LE(0);
            const supported: SupportedCodePage[] = [1250,1251,1252,1253,1254,1255,1256,1257,1258];
            this.cachedCodepage = supported.includes(val as SupportedCodePage) ? val as SupportedCodePage : 1252;
        } else {
            this.cachedCodepage = 1252;
        }
        return this.cachedCodepage;
    }

    async readUnicodeString(path: string[]): Promise<string | undefined> {
        const buf = await this.getProperty(path);
        if (!buf || buf.length === 0) return undefined;

        const prop = path[1].slice(-4);

        if (prop === '001F') return buf.toString('utf16le').replace(/\u0000+$/g, '') || undefined;
        if (prop === '001E') {
            const codepage = await this.getCodepage();
            const decoded = this.decoder.decodeBytes(buf, codepage);
            return decoded.replace(/\u0000+$/g, '').trim() || undefined;
        }

        return undefined;
    }

    async readAttachments(): Promise<RawAttachment[]> {
        const tree = this.cfbf.getTree();
        if (!tree) return [];

        const attachments: RawAttachment[] = [];

        const visit = (node: any) => {
            if (node.name.startsWith('__attach_version1.0')) {
                attachments.push({ storageName: node.name });
            }
            node.children.forEach(visit);
        };
        visit(tree);

        return attachments;
    }
}

export function MsgRawReaderFactory(): MsgRawReader {
    const decoder = container.get<Decoder>('decoder');
    const CFBFReader = container.get<CFBFReader>('cfbReader');
    return new MsgRawReader(decoder,  CFBFReader);
}
