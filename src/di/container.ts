import * as fs from 'node:fs';
import { CFBFReaderFactory } from '../cfb/CFBReader';
import { DirectoryReaderFactory } from '../cfb/readers/directoryReader';
import { FATReaderFactory } from '../cfb/readers/fatReader';
import { HeaderReaderFactory } from '../cfb/readers/headerReader';
import { MiniFATReaderFactory } from '../cfb/readers/miniFATReader';
import { MiniStreamReaderFactory } from '../cfb/readers/miniStreamReader';
import { DecoderFactory } from '../encoding/decoder';
import { NoopLogger } from '../logging/Logger';
import { NamedPropertyReader } from '../mapi/NamedPropertyReader';
import { createMessageReader } from '../msg/createMessageReader';
import { ServiceLocator } from './service-locator';
import { TOKENS } from './tokens';

export function createContainer(): ServiceLocator {
  const result = new ServiceLocator();
  result.register(TOKENS.fs, fs);
  result.register(TOKENS.logger, new NoopLogger());
  result.factory(TOKENS.decoder, DecoderFactory, 'singleton');
  result.factory(TOKENS.headerReader, HeaderReaderFactory, 'singleton');
  result.factory(TOKENS.fatReader, FATReaderFactory, 'scoped');
  result.factory(TOKENS.miniFATReader, MiniFATReaderFactory, 'scoped');
  result.factory(TOKENS.miniStreamReader, MiniStreamReaderFactory, 'scoped');
  result.factory(TOKENS.directoryReader, DirectoryReaderFactory, 'scoped');
  result.factory(TOKENS.cfbReader, CFBFReaderFactory, 'scoped');
  result.factory(
    TOKENS.namedPropertyReader,
    (r) => new NamedPropertyReader(r.get(TOKENS.cfbReader), r.get(TOKENS.logger)),
    'scoped',
  );
  result.factory(TOKENS.msgReader, (r) => createMessageReader({
    cfbReader: r.get(TOKENS.cfbReader),
    decoder: r.get(TOKENS.decoder),
    logger: r.get(TOKENS.logger),
    namedProperties: r.get(TOKENS.namedPropertyReader),
  }));
  return result;
}

export const container = createContainer();
