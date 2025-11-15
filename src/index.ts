import { setupContainer } from './di/setup';
import { container } from './di/container';
import type { HeaderReader } from './headerReader';

setupContainer();

export interface MsgAttachment {
    name: string;
    mime: string;
    content: Buffer;
}

export interface MsgBody {
    text?: string;
    html?: string;
    rtf?: string;
}

export interface Msg {
    subject: string;
    from: { name: string; email: string };
    to: Array<{ name: string; email: string }>;
    cc?: Array<{ name: string; email: string }>;
    body: MsgBody;
    attachments: MsgAttachment[];
}

export async function parseMsg(filePath: string): Promise<Msg> {
    // Resolve HeaderReader factory from container (returns function that creates HeaderReader)
    const headerReaderFactory = container.resolve<() => HeaderReader>('headerReaderFactory');

    if (!headerReaderFactory || typeof headerReaderFactory !== 'function') {
        throw new Error('HeaderReader factory not found or invalid');
    }

    // Create HeaderReader instance using the factory
    const headerReader = headerReaderFactory();

    // Read header from file
    const header = await headerReader.readHeader(filePath);

    console.info('Header read:', header);

    // Your parsing logic here
    return {
        subject: 'Test email',
        from: {name: 'Sender', email: 'sender@example.com'},
        to: [{name: 'Receiver', email: 'receiver@example.com'}],
        body: {text: 'Hello, world!'},
        attachments: [],
    };
}
