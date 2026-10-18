import type { SupportedCodePage } from '../encoding/decoder';
import { UnsupportedMsgFeatureError } from '../errors/errors';
import type { PropertyStreamReader } from './PropertyStreamReader';

/**
 * Reader for determining message codepage from MSG file properties.
 * Caches codepage to avoid reading it multiple times.
 */
export class CodePageReader {
    private cachedCodepage: SupportedCodePage | null = null;

    constructor(
        private readonly propertyStream: PropertyStreamReader,
        private readonly rootStorage: string[] = ['Root Entry'],
    ) {}

    /**
     * Gets the codepage used in the MSG file.
     * Reads PR_MESSAGE_CODEPAGE or PR_INTERNET_CPID from the root property stream.
     * Returns cached value if already determined.
     */
    async getCodepage(): Promise<SupportedCodePage> {
        if (this.cachedCodepage !== null) {
            return this.cachedCodepage;
        }

        const codepageValue = await this.propertyStream.readNumber(this.rootStorage, ['3FFD', '3FDE']);

        if (codepageValue !== undefined) {
            const supportedCodepages: SupportedCodePage[] = [65001, 20127, 28592, 20866, 1250, 1251, 1252, 1253, 1254, 1255, 1256, 1257, 1258];
            if (supportedCodepages.includes(codepageValue as SupportedCodePage)) {
                this.cachedCodepage = codepageValue as SupportedCodePage;
            } else {
                throw new UnsupportedMsgFeatureError(`Unsupported MSG code page: ${codepageValue}`);
            }
        } else {
            // Default codepage if neither fixed property is available
            this.cachedCodepage = 1252;
        }

        return this.cachedCodepage;
    }
}

/**
 * Factory function to create CodePageReader
 */
export function createCodePageReader(propertyStream: PropertyStreamReader): CodePageReader {
    return new CodePageReader(propertyStream);
}

