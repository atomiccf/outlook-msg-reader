import type * as fs from 'node:fs';
import type { CFBFConstants } from '../constants/cfbf';
import type { CFBFReader } from '../cfb/CFBReader';
import type { DirectoryReader } from '../cfb/readers/directoryReader';
import type { FATReader } from '../cfb/readers/fatReader';
import type { HeaderReader } from '../cfb/readers/headerReader';
import type { MiniFATReader } from '../cfb/readers/miniFATReader';
import type { MiniStreamReader } from '../cfb/readers/miniStreamReader';
import type { Decoder } from '../encoding/decoder';
import type { Logger } from '../logging/Logger';
import type { PropertyStore } from '../mapi/PropertyStore';
import type { PropertyStreamReader } from '../mapi/PropertyStreamReader';
import type { AttachmentReader } from '../msg/AttachmentReader';
import type { BodyReader } from '../msg/BodyReader';
import type { CodePageReader } from '../msg/CodePageReader';
import type { MsgReader } from '../msg/MsgReader';
import type { MetadataReader } from '../msg/MetadataReader';
import type { NamedPropertyReader } from '../msg/NamedPropertyReader';
import type { PropertyReader } from '../msg/PropertyReader';
import type { RecipientReader } from '../msg/RecipientReader';
import type { SenderReader } from '../msg/SenderReader';
import type { SubjectReader } from '../msg/SubjectReader';
import { createToken } from './service-locator';

export const TOKENS = {
  fs: createToken<typeof fs>('fs'),
  cfbfConstants: createToken<CFBFConstants>('cfbfConstants'),
  decoder: createToken<Decoder>('decoder'),
  logger: createToken<Logger>('logger'),
  headerReader: createToken<HeaderReader>('headerReader'),
  fatReader: createToken<FATReader>('fatReader'),
  miniFATReader: createToken<MiniFATReader>('miniFATReader'),
  miniStreamReader: createToken<MiniStreamReader>('miniStreamReader'),
  directoryReader: createToken<DirectoryReader>('directoryReader'),
  cfbReader: createToken<CFBFReader>('cfbReader'),
  codePageReader: createToken<CodePageReader>('codePageReader'),
  propertyReader: createToken<PropertyReader>('propertyReader'),
  propertyStore: createToken<PropertyStore>('propertyStore'),
  propertyStreamReader: createToken<PropertyStreamReader>('propertyStreamReader'),
  namedPropertyReader: createToken<NamedPropertyReader>('namedPropertyReader'),
  subjectReader: createToken<SubjectReader>('subjectReader'),
  bodyReader: createToken<BodyReader>('bodyReader'),
  senderReader: createToken<SenderReader>('senderReader'),
  recipientReader: createToken<RecipientReader>('recipientReader'),
  attachmentReader: createToken<AttachmentReader>('attachmentReader'),
  metadataReader: createToken<MetadataReader>('metadataReader'),
  msgReader: createToken<MsgReader>('msgReader'),
} as const;
