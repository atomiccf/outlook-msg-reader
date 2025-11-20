import type { SupportedCodePage } from '../encoding/decoder';
import type { CFBFReader } from "../сfb/CFBReader";

/**
 * Reader for determining message codepage from MSG file properties.
 * Caches codepage to avoid reading it multiple times.
 */
export class CodePageReader {
    private cachedCodepage: SupportedCodePage | null = null;

    constructor(private readonly cfbReader: CFBFReader) {}

    /**
     * Gets the codepage used in the MSG file.
     * Reads PR_MESSAGE_CODEPAGE property (__substg1.0_3FFD001E).
     * Returns cached value if already determined.
     */
    async getCodepage(): Promise<SupportedCodePage> {
        if (this.cachedCodepage !== null) {
            return this.cachedCodepage;
        }

        // Read PR_MESSAGE_CODEPAGE property (__substg1.0_3FFD001E)
        const codepageBuf = await this.cfbReader.readStream(['Root Entry', '__substg1.0_3FFD001E']);
        
        if (codepageBuf && codepageBuf.length >= 4) {
            // Read 32-bit little-endian integer
            const codepageValue = codepageBuf.readUInt32LE(0);
            // Validate that it's a supported codepage, fallback to 1252 if not
            const supportedCodepages: SupportedCodePage[] = [1250, 1251, 1252, 1253, 1254, 1255, 1256, 1257, 1258];
            if (supportedCodepages.includes(codepageValue as SupportedCodePage)) {
                this.cachedCodepage = codepageValue as SupportedCodePage;
            } else {
                this.cachedCodepage = 1252; // Default to Windows-1252
            }
        } else {
            // Default codepage if property is not found
            this.cachedCodepage = 1252;
        }

        return this.cachedCodepage;
    }
}

/**
 * Factory function to create CodePageReader
 */
export function createCodePageReader(cfbReader: CFBFReader): CodePageReader {
    return new CodePageReader(cfbReader);
}

