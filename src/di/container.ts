import * as fs from 'node:fs';
import { CFBFConstants } from '../constants/cfbf';
import { CFBFReaderFactory } from '../cfb/CFBReader';
import { DirectoryReaderFactory } from '../cfb/readers/directoryReader';
import { FATReaderFactory } from '../cfb/readers/fatReader';
import { HeaderReaderFactory } from '../cfb/readers/headerReader';
import { MiniFATReaderFactory } from '../cfb/readers/miniFATReader';
import { MiniStreamReaderFactory } from '../cfb/readers/miniStreamReader';
import { DecoderFactory } from '../encoding/decoder';
import { NoopLogger } from '../logging/Logger';
import { PropertyStore } from '../mapi/PropertyStore';
import { PropertyStreamReader } from '../mapi/PropertyStreamReader';
import { AttachmentReader } from '../msg/AttachmentReader';
import { BodyReader } from '../msg/BodyReader';
import { CodePageReader } from '../msg/CodePageReader';
import { MsgReader } from '../msg/MsgReader';
import { MetadataReader } from '../msg/MetadataReader';
import { NamedPropertyReader } from '../msg/NamedPropertyReader';
import { PropertyReader } from '../msg/PropertyReader';
import { RecipientReader } from '../msg/RecipientReader';
import { SenderReader } from '../msg/SenderReader';
import { SubjectReader } from '../msg/SubjectReader';
import { ServiceLocator } from './service-locator';
import { TOKENS } from './tokens';

export function createContainer(): ServiceLocator {
  const result = new ServiceLocator();
  result.register(TOKENS.fs, fs);
  result.register(TOKENS.cfbfConstants, new CFBFConstants());
  result.register(TOKENS.logger, new NoopLogger());
  result.factory(TOKENS.decoder, DecoderFactory, 'singleton');
  result.factory(TOKENS.headerReader, HeaderReaderFactory, 'singleton');
  result.factory(TOKENS.fatReader, FATReaderFactory, 'scoped');
  result.factory(TOKENS.miniFATReader, MiniFATReaderFactory, 'scoped');
  result.factory(TOKENS.miniStreamReader, MiniStreamReaderFactory, 'scoped');
  result.factory(TOKENS.directoryReader, DirectoryReaderFactory, 'scoped');
  result.factory(TOKENS.cfbReader, CFBFReaderFactory, 'scoped');
  result.factory(TOKENS.propertyStreamReader, (r) => new PropertyStreamReader(r.get(TOKENS.cfbReader)), 'scoped');
  result.factory(TOKENS.codePageReader, (r) => new CodePageReader(r.get(TOKENS.propertyStreamReader)), 'scoped');
  result.factory(TOKENS.propertyReader, (r) => new PropertyReader(r.get(TOKENS.cfbReader), r.get(TOKENS.decoder), r.get(TOKENS.codePageReader)), 'scoped');
  result.factory(
    TOKENS.propertyStore,
    (r) => new PropertyStore(
      r.get(TOKENS.cfbReader),
      r.get(TOKENS.propertyReader),
      r.get(TOKENS.namedPropertyReader),
    ),
    'scoped',
  );
  result.factory(
    TOKENS.namedPropertyReader,
    (r) => new NamedPropertyReader(r.get(TOKENS.cfbReader), r.get(TOKENS.logger)),
    'scoped',
  );
  result.factory(TOKENS.subjectReader, (r) => new SubjectReader(r.get(TOKENS.propertyStore), r.get(TOKENS.decoder)));
  result.factory(TOKENS.bodyReader, (r) => new BodyReader(r.get(TOKENS.propertyStore), r.get(TOKENS.logger)));
  result.factory(TOKENS.senderReader, (r) => new SenderReader(r.get(TOKENS.propertyStore)));
  result.factory(TOKENS.recipientReader, (r) => new RecipientReader(r.get(TOKENS.propertyStore), r.get(TOKENS.propertyStreamReader), r.get(TOKENS.logger)));
  result.factory(TOKENS.attachmentReader, (r) => new AttachmentReader(r.get(TOKENS.cfbReader), r.get(TOKENS.propertyStore), r.get(TOKENS.propertyStreamReader)));
  result.factory(TOKENS.metadataReader, (r) => new MetadataReader(r.get(TOKENS.propertyStore), r.get(TOKENS.propertyStreamReader)));
  result.factory(TOKENS.msgReader, (r) => new MsgReader(
    r.get(TOKENS.cfbReader), r.get(TOKENS.subjectReader), r.get(TOKENS.bodyReader),
    r.get(TOKENS.senderReader), r.get(TOKENS.recipientReader), r.get(TOKENS.attachmentReader),
    r.get(TOKENS.metadataReader),
  ));
  return result;
}

export const container = createContainer();
