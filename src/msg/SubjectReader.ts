import type { Decoder } from '../encoding/decoder';
import type { PropertyStore } from '../mapi/PropertyStore';

export class SubjectReader {
  constructor(private readonly properties: PropertyStore, private readonly decoder: Decoder) {}

  async read(): Promise<string> {
    const subject = await this.properties.readString(['0037', '0039', '0070', '0E1D', '103E', '1042']);
    if (subject?.trim()) return subject.trim();

    const headers = await this.properties.readString(['007D']);
    const unfolded = headers?.replace(/\r?\n[ \t]+/g, ' ');
    const match = unfolded?.match(/^Subject:\s*(.+)$/im);
    return match ? this.decoder.decodeRFC2047(match[1].trim()) : '';
  }
}
