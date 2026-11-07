import type { SupportedCodePage } from '../encoding/decoder';
import { UnsupportedMsgFeatureError } from '../errors/errors';
import type { PropertyStreamReader } from './PropertyStreamReader';

/**
 * Reader for determining message codepage from MSG file properties.
 * Caches codepage to avoid reading it multiple times.
 */
export class CodePageReader {
    private readonly cachedCodepages = new Map<boolean, SupportedCodePage>();

    constructor(
        private readonly propertyStream: PropertyStreamReader,
        private readonly rootStorage: string[] = ['Root Entry'],
    ) {}

    /**
     * Gets the codepage used in the MSG file.
     * Prefers PR_INTERNET_CPID for HTML and PR_MESSAGE_CODEPAGE for other strings.
     * Returns cached value if already determined.
     */
    async getCodepage(preferInternet = false): Promise<SupportedCodePage> {
        const cachedCodepage = this.cachedCodepages.get(preferInternet);
        if (cachedCodepage !== undefined) {
            return cachedCodepage;
        }

        const codepageValue = await this.propertyStream.readNumber(this.rootStorage,
            preferInternet ? ['3FDE', '3FFD'] : ['3FFD', '3FDE']) ?? 1252;

        const supportedCodepages: SupportedCodePage[] = [65001, 20127, 28592, 20866, 1250, 1251, 1252, 1253, 1254, 1255, 1256, 1257, 1258];
        if (!supportedCodepages.includes(codepageValue as SupportedCodePage)) {
            throw new UnsupportedMsgFeatureError(`Unsupported MSG code page: ${codepageValue}`);
        }

        this.cachedCodepages.set(preferInternet, codepageValue as SupportedCodePage);
        return codepageValue as SupportedCodePage;
    }
}

/**
 * Factory function to create CodePageReader
 */
export function createCodePageReader(propertyStream: PropertyStreamReader): CodePageReader {
    return new CodePageReader(propertyStream);
}

