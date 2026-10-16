import type { PropertyStore } from '../mapi/PropertyStore';
import type { PropertyStreamReader } from '../mapi/PropertyStreamReader';
import type { MsgImportance, MsgMetadata } from '../types';

export class MetadataReader {
  constructor(
    private readonly properties: PropertyStore,
    private readonly propertyStream: PropertyStreamReader,
  ) {}

  async read(): Promise<MsgMetadata> {
    const rootStorage = this.properties.getRootStorage?.() ?? ['Root Entry'];
    const [messageId, transportHeaders, sentAt, receivedAt, importanceValue] = await Promise.all([
      this.properties.readStringAt(rootStorage, ['1035']),
      this.properties.readStringAt(rootStorage, ['007D']),
      this.propertyStream.read(rootStorage, ['0039']),
      this.propertyStream.read(rootStorage, ['0E06']),
      this.propertyStream.readNumber(rootStorage, ['0017']),
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
