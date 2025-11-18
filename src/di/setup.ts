
import { container } from './container';
import { CFBFConstants } from '../constants/cfbf';
import { HeaderReaderFactory } from '../readers/headerReader';
import { FATReaderFactory } from '../readers/fatReader';
import { MiniFATReaderFactory } from '../readers/miniFATReader';
import { MiniStreamReaderFactory } from '../readers/miniStreamReader';
import * as fs from 'node:fs';
import {DirectoryReaderFactory} from "../readers/directoryReader";
import { DecoderFactory } from '../encoding/decoder';

/**
 * Configure all dependencies
 * Call this once at application startup
 */
export function setupContainer(): void {
    // Register constants as singleton
    container.register(CFBFConstants, new CFBFConstants());
    container.register('fs', fs);

     // This way resolve() will return () => HeaderReader, not HeaderReader
    container.factory(
        "headerReaderFactory",
        () => HeaderReaderFactory,  // Return the factory function itself
        true // singleton - same factory function instance
    );
    container.factory(
        "fatReaderFactory",
        () => FATReaderFactory,  // Return the factory function itself
        true // singleton - same factory function instance
    );
    container.factory(
        "directoryReaderFactory",
        () => DirectoryReaderFactory,  // Return the factory function itself
        true // singleton - same factory function instance
    );
    container.factory(
        "miniFATReaderFactory",
        () => MiniFATReaderFactory,  // Return the factory function itself
        true // singleton - same factory function instance
    );
    container.factory(
        "miniStreamReaderFactory",
        () => MiniStreamReaderFactory,  // Return the factory function itself
        true // singleton - same factory function instance
    );

    // Register decoder as singleton instance
    container.factory(
        "decoder",
        () => DecoderFactory(),  // Call the factory to create Decoder instance
        true // singleton - reuse the same decoder instance
    );

}
