import type { Logger } from '../logging/Logger';
import { PropertyDecodeError } from '../errors/errors';
import type { PropertyStore } from '../mapi/PropertyStore';
import type { PropertyStreamReader } from '../mapi/PropertyStreamReader';
import type { MsgRecipient } from '../types';
import { DEFAULT_MAX_RECIPIENTS } from '../api/options';

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

  async read(maxRecipients = DEFAULT_MAX_RECIPIENTS, maxResultBytes?: number, existingResultBytes = 0): Promise<Recipients> {
    if (!Number.isSafeInteger(maxRecipients) || maxRecipients < 0) {
      throw new RangeError('maxRecipients must be a non-negative safe integer');
    }
    const to: MsgRecipient[] = [];
    const cc: MsgRecipient[] = [];
    const bcc: MsgRecipient[] = [];

    const storages = this.properties.findStorages('__recip_version1.0_');
    if (storages.length > maxRecipients) {
      throw new RangeError(`MSG has more than maxRecipients (${maxRecipients})`);
    }
    let count = 0;
    let usedBytes = existingResultBytes;
    const charge = (value: string): void => {
      const bytes = Buffer.byteLength(value);
      if (maxResultBytes !== undefined && bytes > maxResultBytes - usedBytes) {
        throw new RangeError(`MSG result exceeds maxResultBytes (${maxResultBytes})`);
      }
      usedBytes += bytes;
    };
    const append = (list: MsgRecipient[], recipient: MsgRecipient): void => {
      if (count >= maxRecipients) {
        throw new RangeError(`MSG has more than maxRecipients (${maxRecipients})`);
      }
      count += 1;
      list.push(recipient);
    };
    for (const storagePath of storages) {
      try {
        const type = (await this.propertyStream.readNumber(storagePath, ['0C15'])) ?? 1;
        const name = (await this.properties.readStringAt(storagePath, ['3001', '39FF'])) ?? '';
        charge(name);
        const email = (await this.properties.readStringAt(storagePath, ['39FE', '3003', '0C1F'])) ?? '';
        charge(email);
        const recipient = { name, email };
        if (!recipient.name && !recipient.email) continue;
        append(type === 2 ? cc : type === 3 ? bcc : to, recipient);
      } catch (error) {
        if (error instanceof RangeError) throw error;
        const message = `Unable to read recipient at ${storagePath.join(' / ')}`;
        this.logger.warn(message, error);
        throw new PropertyDecodeError(message, error);
      }
    }

    for (const [list, id] of [[to, '0E04'], [cc, '0E03'], [bcc, '0E02']] as const) {
      if (list.length) continue;
      const display = (await this.properties.readString([id])) ?? '';
      for (const recipient of this.parseDisplay(display)) {
        charge(recipient.name);
        charge(recipient.email);
        append(list, recipient);
      }
    }

    return { to, ...(cc.length ? { cc } : {}), ...(bcc.length ? { bcc } : {}) };
  }

  private *parseDisplay(value: string): Generator<MsgRecipient> {
    let start = 0;
    while (start < value.length) {
      const separator = value.indexOf(';', start);
      const end = separator < 0 ? value.length : separator;
      const part = value.slice(start, end).trim();
      start = end + 1;
      if (!part) continue;
      // A line break can occur only in whitespace immediately before '<'.
      const afterLineBreak = 1 + Math.max(part.lastIndexOf('\r'), part.lastIndexOf('\n'),
        part.lastIndexOf('\u2028'), part.lastIndexOf('\u2029'));
      const open = part.indexOf('<', Math.max(1, afterLineBreak));
      const name = open > 0 ? part.slice(0, open).trim() : '';
      if (open > 0 && open < part.length - 2 && part.endsWith('>') && !/[\r\n\u2028\u2029]/.test(name)) {
        yield { name, email: part.slice(open + 1, -1).trim() };
      } else {
        yield part.includes('@') ? { name: '', email: part } : { name: part, email: '' };
      }
    }
  }
}
