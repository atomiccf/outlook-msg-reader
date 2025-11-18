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
}

export function DecoderFactory(): Decoder {
    return new Decoder();
}


