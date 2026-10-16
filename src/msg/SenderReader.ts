import type { PropertyStore } from '../mapi/PropertyStore';
import type { MsgRecipient } from '../types';

export class SenderReader {
  constructor(private readonly properties: PropertyStore) {}

  async read(): Promise<MsgRecipient> {
    return {
      name: (await this.properties.readString(['0C1A', '0042'])) ?? '',
      email: (await this.properties.readString(['5D01', '5D02', '0C1F', '0065'])) ?? '',
    };
  }
}
