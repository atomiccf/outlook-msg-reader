import * as fs from 'node:fs';
import { ServiceLocator } from './service-locator';
import { CFBFConstants } from '../constants/cfbf';
import { HeaderReaderFactory } from '../readers/headerReader';
import { FATReaderFactory } from '../readers/fatReader';
import { MiniFATReaderFactory } from '../readers/miniFATReader';
import { MiniStreamReaderFactory } from '../readers/miniStreamReader';
import { DirectoryReaderFactory } from "../readers/directoryReader";
import { DecoderFactory } from '../encoding/decoder';

/**
 * Configure all dependencies
 * Call this once at application startup
 */
const container = new ServiceLocator()

// Register dependencies 
    container.register("cfbfConstants", new CFBFConstants());
    container.register('fs', fs);
    container.register("decoder",DecoderFactory);
    container.factory("headerReader",HeaderReaderFactory);
    container.factory("fatReader",FATReaderFactory,);
    container.factory("directoryReader",DirectoryReaderFactory);
    container.factory("miniFATReader",MiniFATReaderFactory);
    container.factory("miniStreamReader",MiniStreamReaderFactory);

export { container };


