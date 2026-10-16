import type { PropertyStore } from '../mapi/PropertyStore';
import type { PropertyStreamReader } from '../mapi/PropertyStreamReader';
import type { MsgImportance, MsgMetadata } from '../types';

const ROOT_STORAGE = ['Root Entry'];

export class MetadataReader {
  constructor(
    private readonly properties: PropertyStore,
    private readonly propertyStream: PropertyStreamReader,
  ) {}

  async read(): Promise<MsgMetadata> {
    const [messageId, transportHeaders, sentAt, receivedAt, importanceValue] = await Promise.all([
      this.properties.readStringAt(ROOT_STORAGE, ['1035']),
      this.properties.readStringAt(ROOT_STORAGE, ['007D']),
      this.propertyStream.read(ROOT_STORAGE, ['0039']),
      this.propertyStream.read(ROOT_STORAGE, ['0E06']),
      this.propertyStream.readNumber(ROOT_STORAGE, ['0017']),
    ]);

    return {
      messageId: messageId?.trim() || undefined,
      transportHeaders: transportHeaders?.trim() || undefined,
      sentAt: this.asValidDate(sentAt),
      receivedAt: this.asValidDate(receivedAt),
      importance: this.asImportance(importanceValue),
    };
  }

  private asValidDate(value: unknown): Date | undefined {
    return value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined;
  }

  private asImportance(value: number | undefined): MsgImportance | undefined {
    switch (value) {
      case 0: return 'low';
      case 1: return 'normal';
      case 2: return 'high';
      default: return undefined;
    }
  }
}
