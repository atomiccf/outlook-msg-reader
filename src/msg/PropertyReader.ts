import type { CFBFReader } from "../сfb/CFBReader";
import type { Decoder } from '../encoding/decoder';
import type { CodePageReader } from './CodePageReader';

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
     * Reads a unicode string property from the MSG file.
     * Supports UTF-16 (001F) and ANSI codepage (001E) property types.
     */
    async readUnicodeString(path: string[]): Promise<string | undefined> {
        const buf = await this.cfbReader.readStream(path);
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
            const codepage = await this.codePageReader.getCodepage();
            const decoded = this.decoder.decodeBytes(buf, codepage);
            // Remove null bytes and trim, return undefined if empty
            const cleaned = decoded.replace(/\u0000+$/g, '').trim();
            return cleaned || undefined;
        }

        // Unknown property type, return undefined
        return undefined;
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

