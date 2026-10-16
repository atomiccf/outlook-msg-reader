import type { CFBFReader } from "../cfb/CFBReader";
import type { Decoder } from '../encoding/decoder';
import type { CodePageReader } from './CodePageReader';
import { PropertyDecodeError } from '../errors/errors';

/**
 * Reader for MSG file properties.
 * Handles reading unicode strings, binary strings, and binary data.
 */
export class PropertyReader {
    constructor(
        private readonly cfbReader: CFBFReader,
        private readonly decoder: Decoder,
        private readonly codePageReader: CodePageReader
    ) {}

    /**
     * Extracts property type (001F, 001E, 0102, etc) safely from stream name.
     */
    private getPropertyType(path: string[]): string | undefined {
        const name = path[path.length - 1];
        const match = name.match(/_(\w{4})(\w{4})$/);
        if (!match) return undefined;
        return match[2].toUpperCase();
    }

    /**
     * Reads a unicode string property from the MSG file.
     * Supports UTF-16 (001F) and ANSI codepage (001E) property types.
     */
    async readUnicodeString(path: string[]): Promise<string | undefined> {
        const buf = await this.cfbReader.readStream(path);
        if (!buf || buf.length === 0) return undefined;

        const type = this.getPropertyType(path);

        if (type === "001F") {
            // UTF-16, иногда с BOM
            let result = buf.toString("utf16le");
            // удалить BOM, если есть
            if (result.charCodeAt(0) === 0xFEFF) result = result.slice(1);
            return result.replace(/\u0000+$/g, '') || undefined;
        }

        // Для ANSI всегда использовать кодовую страницу
        const codepage = await this.codePageReader.getCodepage();
        const result = this.decoder.decodeBytes(buf, codepage).replace(/\u0000+$/g, '');
        return result || undefined;
    }


    /**
     * Reads a string from binary property (0102 type).
     * Handles UTF-16 LE/BE BOM, UTF-8 BOM, and fallback encodings.
     */
    async readStringFromBinary(path: string[]): Promise<string | undefined> {
        const buf = await this.cfbReader.readStream(path);
        if (!buf || buf.length === 0) {
            return undefined;
        }

        try {
            // Check for UTF-16 LE BOM (0xFF 0xFE)
            if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
                const result = buf.subarray(2).toString('utf16le').replace(/\u0000+$/g, '').trim();
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
                const result = buf.subarray(3).toString('utf8').replace(/\u0000+$/g, '').trim();
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
        } catch (error) {
            throw new PropertyDecodeError(`Unable to decode property at ${path.join(' / ')}`, error);
        }
    }

    /**
     * Reads binary data from a property path.
     */
    async readBinary(path: string[]): Promise<Buffer | undefined> {
        const buf = await this.cfbReader.readStream(path);
        return buf ?? undefined;
    }
}

/**
 * Factory function to create PropertyReader
 */
export function createPropertyReader(
    cfbReader: CFBFReader,
    decoder: Decoder,
    codePageReader: CodePageReader
): PropertyReader {
    return new PropertyReader(cfbReader, decoder, codePageReader);
}

