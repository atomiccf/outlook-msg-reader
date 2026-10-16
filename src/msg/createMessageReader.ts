import type { CFBFReader } from '../cfb/CFBReader';
import type { Decoder } from '../encoding/decoder';
import type { Logger } from '../logging/Logger';
import { CodePageReader } from '../mapi/CodePageReader';
import type { NamedPropertyReader } from '../mapi/NamedPropertyReader';
import { PropertyReader } from '../mapi/PropertyReader';
import { PropertyStore } from '../mapi/PropertyStore';
import { PropertyStreamReader } from '../mapi/PropertyStreamReader';
import { AttachmentReader } from './AttachmentReader';
import { BodyReader } from './BodyReader';
import { MetadataReader } from './MetadataReader';
import { MsgReader } from './MsgReader';
import { RecipientReader } from './RecipientReader';
import { SenderReader } from './SenderReader';
import { SubjectReader } from './SubjectReader';

export interface MessageReaderDependencies {
  cfbReader: CFBFReader;
  decoder: Decoder;
  logger: Logger;
  namedProperties: NamedPropertyReader;
}

/** Builds the readers for a message stored at any CFBF storage path. */
export function createMessageReader(
  dependencies: MessageReaderDependencies,
  rootStorage: string[] = ['Root Entry'],
  embeddedMessageDepth = 0,
): MsgReader {
  const { cfbReader, decoder, logger, namedProperties } = dependencies;
  const propertyStream = new PropertyStreamReader(cfbReader);
  const codePageReader = new CodePageReader(propertyStream, rootStorage);
  const propertyReader = new PropertyReader(cfbReader, decoder, codePageReader);
  const properties = new PropertyStore(cfbReader, propertyReader, namedProperties, rootStorage);
  const createEmbeddedReader = (storagePath: string[]) =>
    createMessageReader(dependencies, storagePath, embeddedMessageDepth + 1);
  const attachmentReader = new AttachmentReader(
    cfbReader,
    properties,
    propertyStream,
    createEmbeddedReader,
    embeddedMessageDepth,
  );

  return new MsgReader(
    cfbReader,
    new SubjectReader(properties, decoder),
    new BodyReader(properties, logger, decoder, codePageReader),
    new SenderReader(properties),
    new RecipientReader(properties, propertyStream, logger),
    attachmentReader,
    new MetadataReader(properties, propertyStream),
  );
}
