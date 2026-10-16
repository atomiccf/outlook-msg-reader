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
import type { MsgReader } from '../msg/MsgReader';
import type { NamedPropertyReader } from '../mapi/NamedPropertyReader';
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
  namedPropertyReader: createToken<NamedPropertyReader>('namedPropertyReader'),
  msgReader: createToken<MsgReader>('msgReader'),
} as const;
