import type { Logger } from '../logging/Logger';
import { PropertyDecodeError } from '../errors/errors';
import type { PropertyStore } from '../mapi/PropertyStore';
import type { PropertyStreamReader } from '../mapi/PropertyStreamReader';
import type { MsgRecipient } from '../types';

export interface Recipients {
  to: MsgRecipient[];
  cc?: MsgRecipient[];
  bcc?: MsgRecipient[];
}

export class RecipientReader {
  constructor(
    private readonly properties: PropertyStore,
    private readonly propertyStream: PropertyStreamReader,
    private readonly logger: Logger,
  ) {}

  async read(): Promise<Recipients> {
    const to: MsgRecipient[] = [];
    const cc: MsgRecipient[] = [];
    const bcc: MsgRecipient[] = [];

    for (const storagePath of this.properties.findStorages('__recip_version1.0_')) {
      try {
        const type = (await this.propertyStream.readNumber(storagePath, ['0C15'])) ?? 1;
        const recipient = {
          name: (await this.properties.readStringAt(storagePath, ['3001', '39FF'])) ?? '',
          email: (await this.properties.readStringAt(storagePath, ['39FE', '3003', '0C1F'])) ?? '',
        };
        if (!recipient.name && !recipient.email) continue;
        (type === 2 ? cc : type === 3 ? bcc : to).push(recipient);
      } catch (error) {
        const message = `Unable to read recipient at ${storagePath.join(' / ')}`;
        this.logger.warn(message, error);
        throw new PropertyDecodeError(message, error);
      }
    }

    if (!to.length) {
      to.push(...this.parseDisplay((await this.properties.readString(['0E04'])) ?? ''));
    }
    if (!cc.length) {
      cc.push(...this.parseDisplay((await this.properties.readString(['0E03'])) ?? ''));
    }
    if (!bcc.length) {
      bcc.push(...this.parseDisplay((await this.properties.readString(['0E02'])) ?? ''));
    }

    return { to, ...(cc.length ? { cc } : {}), ...(bcc.length ? { bcc } : {}) };
  }

  private parseDisplay(value: string): MsgRecipient[] {
    return value.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const match = /^(.+?)\s*<(.+?)>$/.exec(part);
      if (match) return { name: match[1].trim(), email: match[2].trim() };
      return part.includes('@') ? { name: '', email: part } : { name: part, email: '' };
    });
  }
}
