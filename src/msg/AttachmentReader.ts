import type { CFBFReader } from '../cfb/CFBReader';
import type { PropertyStore } from '../mapi/PropertyStore';
import type { PropertyStreamReader } from '../mapi/PropertyStreamReader';
import type { MsgAttachment } from '../types';
import { bufToUnicode } from '../utils/utils';

export class AttachmentReader {
  constructor(
    private readonly cfbReader: CFBFReader,
    private readonly properties: PropertyStore,
    private readonly propertyStream: PropertyStreamReader,
  ) {}

  async readAttachments(): Promise<MsgAttachment[]> {
    const attachments: MsgAttachment[] = [];
    for (const storagePath of this.properties.findStorages('__attach_version1.0_')) {
      const method = await this.propertyStream.readNumber(storagePath, ['3705']);
      const kind = method === 5
        ? 'embedded-message'
        : 'file';
      const data =
        (await this.cfbReader.readStream([...storagePath, '__substg1.0_37010102'])) ??
        (await this.cfbReader.readStream([...storagePath, '__substg1.0_3701000D']));
      const longName = await this.cfbReader.readStream([...storagePath, '__substg1.0_3707001F']);
      const shortName = await this.cfbReader.readStream([...storagePath, '__substg1.0_3704001F']);
      const mimeValue = await this.cfbReader.readStream([...storagePath, '__substg1.0_370E001F']);
      attachments.push({
        name: bufToUnicode(longName) ?? bufToUnicode(shortName) ?? `attachment_${attachments.length + 1}`,
        mime: bufToUnicode(mimeValue) ?? 'application/octet-stream',
        content: data ?? Buffer.alloc(0),
        kind,
      });
    }
    return attachments;
  }
}
