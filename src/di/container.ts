import * as fs from 'node:fs';
import { ServiceLocator } from './service-locator';
import { CFBFConstants } from '../constants/cfbf';
import { HeaderReaderFactory } from '../сfb/readers/headerReader';
import { FATReaderFactory } from '../сfb/readers/fatReader';
import { MiniFATReaderFactory } from '../сfb/readers/miniFATReader';
import { MiniStreamReaderFactory } from '../сfb/readers/miniStreamReader';
import { DirectoryReaderFactory } from "../сfb/readers/directoryReader";
import { DecoderFactory } from '../encoding/decoder';
import { CFBFReaderFactory } from '../сfb/CFBReader';
import { MsgRawReaderFactory } from '../readers/MsgRawReader'
/**
 * Configure all dependencies
 * Call this once at application startup
 */
const container = new ServiceLocator()

// Register dependencies
    container.register("cfbfConstants", new CFBFConstants());
    container.register('fs', fs);
    container.factory("decoder",DecoderFactory);
    container.factory("headerReader",HeaderReaderFactory);
    container.factory("fatReader",FATReaderFactory,);
    container.factory("directoryReader",DirectoryReaderFactory);
    container.factory("miniFATReader",MiniFATReaderFactory);
    container.factory("miniStreamReader",MiniStreamReaderFactory);
    container.factory("cfbReader",CFBFReaderFactory);
    container.factory("msgRawReader",MsgRawReaderFactory);

export { container };


