import {
    CP1250,
    CP1251,
    CP1252,
    CP1253,
    CP1254,
    CP1255,
    CP1256,
    CP1257,
    CP1258
} from "./index";

export type SupportedCodePage =
    | 1250 | 1251 | 1252 | 1253 | 1254 | 1255 | 1256 | 1257 | 1258;

const TABLES: Record<SupportedCodePage, string[]> = {
    1250: CP1250,
    1251: CP1251,
    1252: CP1252,
    1253: CP1253,
    1254: CP1254,
    1255: CP1255,
    1256: CP1256,
    1257: CP1257,
    1258: CP1258
};

export class Decoder {
     decodeBytes(bytes: Uint8Array, codepage: SupportedCodePage): string {
        const table = TABLES[codepage];
        if (!table) throw new Error(`Unknown code page: ${codepage}`);

        let result = "";
        for (let i = 0; i < bytes.length; i++) {
            result += table[bytes[i]];
        }
        return result;
    }

    decodeRFC2047(header: string): string {
        header = header.replace(
            /(=\?[^?]+\?[bqBQ]\?[^?]+\?=)\s+(=\?[^?]+\?[bqBQ]\?[^?]+\?=)/g,
            "$1$2"
        );
        // матчим все encoded-word
        return header.replace(/=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g, (_, charset, encoding, text) => {
            let buf: Buffer;
            encoding = encoding.toUpperCase();

            if (encoding === 'B') {
                buf = Buffer.from(text, 'base64');
            } else if (encoding === 'Q') {
                const qp = text.replace(/_/g, ' ').replace(/=([A-Fa-f0-9]{2})/g, (_:any, hex:string) =>
                    String.fromCharCode(parseInt(hex, 16))
                );
                buf = Buffer.from(qp, 'binary');
            } else {
                return text;
            }

            // map charset к Node.js
            const mapCharset = (cs: string) => {
                switch (cs.toLowerCase()) {
                    case 'utf-8': return 'utf8';
                    case 'us-ascii': return 'ascii';
                    case 'iso-8859-1': return 'latin1';
                    default: return 'utf8';
                }
            };

            try {
                return buf.toString(mapCharset(charset));
            } catch {
                return buf.toString('utf8');
            }
        });
    }
}

export function DecoderFactory(): Decoder {
    return new Decoder();
}


