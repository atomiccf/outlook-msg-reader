
import { container } from './container';
import { CFBFConstants } from '../constants/cfbf';
import { HeaderReaderFactory } from '../headerReader';
import { FATReaderFactory } from '../fatReader';
import * as fs from 'node:fs';

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
}
