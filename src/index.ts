import { setupContainer } from './di/setup';
import { container } from './di/container';
import type { HeaderReader } from './readers/headerReader';
import type { FATReader } from './readers/fatReader';
import type { HeaderInfo, Msg, MsgBody, MsgAttachment } from './types';
setupContainer();

export async function parseMsg(filePath: string): Promise<Msg> {
    // Resolve HeaderReader factory from container (returns function that creates HeaderReader)
    const headerReaderFactory = container.resolve<() => HeaderReader>('headerReaderFactory');
    const fatReaderFactory = container.resolve<() => FATReader>('fatReaderFactory');

    if (!headerReaderFactory || typeof headerReaderFactory !== 'function') {
        throw new Error('HeaderReader factory not found or invalid');
    }

   const headerReader = headerReaderFactory();

    // Read a header from the file
    const { header, stream } = await headerReader.readHeaderWithStream(filePath);

    const headerInfo: HeaderInfo = {

        sectorSize: 1 << header.readUInt16LE(30),
        miniSectorSize: 1 << header.readUInt16LE(32),
        numFATSectors: header.readUInt32LE(44),
        dirSectorLocation: header.readUInt32LE(48),
        numDirectorySectors: header.readUInt32LE(40),
        miniStreamCutoffSize: header.readUInt32LE(56),
        miniFatStartSector: header.readUInt32LE(0x3C),
        miniFatSectorCount: header.readUInt32LE(0x40),
        fatSectorLocations: Array.from({ length: 109 }, (_, i) => header.readUInt32LE(76 + i * 4)),
        signature: header.subarray(0, 8),
        rawHeader: header
    };


    if (!fatReaderFactory || typeof fatReaderFactory !== 'function') {
        throw new Error('FATReader factory not found or invalid');
    }
    const fatReader = fatReaderFactory();
    const fatTable = await fatReader.buildTable(stream, headerInfo);

    console.info('Header read:', header);
    console.info('FAT table build:', fatTable);
    // Your parsing logic here
    return {
        subject: 'Test email',
        from: {name: 'Sender', email: 'sender@example.com'},
        to: [{name: 'Receiver', email: 'receiver@example.com'}],
        body: {text: 'Hello, world!'},
        attachments: [],
    };
}
