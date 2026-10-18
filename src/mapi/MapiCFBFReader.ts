import { CFBFReader } from '../cfb/CFBReader';
import { Decoder } from '../encoding/decoder';
import { trimNullPadding } from '../utils/utils';
import { CodePageReader } from './CodePageReader';
import { PropertyStreamReader } from './PropertyStreamReader';

/** Preserves the public CFBFReader string API on top of the format-neutral CFBF reader. */
export class MapiCFBFReader extends CFBFReader {
    async readStreamAsString(path: string[], propertyType?: number): Promise<string | null> {
        const buffer = await this.readStream(path);
        if (!buffer) return null;

        if (!propertyType) return buffer.toString(); // fallback

        switch (propertyType) {
            case 0x001F: // PT_UNICODE
                return trimNullPadding(buffer.toString('utf16le'));
            case 0x001E: // PT_STRING8
            {
                const embeddedRootIndex = path.lastIndexOf('__substg1.0_3701000D');
                const rootName = this.getTree()?.name ?? 'Root Entry';
                const storagePath = embeddedRootIndex < 0 ? [] : path.slice(0, embeddedRootIndex + 1);
                const rootStorage = storagePath[0] === rootName
                    ? storagePath
                    : [rootName, ...storagePath];
                const codepage = await new CodePageReader(
                    new PropertyStreamReader(this),
                    rootStorage,
                ).getCodepage();
                return trimNullPadding(new Decoder().decodeBytes(buffer, codepage));
            }
            case 0x0102: // PT_BINARY
                return buffer.toString('hex');
            default:
                return buffer.toString();
        }
    }
}
