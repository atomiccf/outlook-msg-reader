import type { Msg, MsgBody, MsgAttachment } from './types';
import { MsgRawReader } from '../src/readersM/sgRawReader';

export class MsgParser {
    static async parse(raw: MsgRawReader): Promise<Msg> {
        const subject = await raw.readUnicodeString(['Root Entry', '__substg1.0_0037001F'])
            ?? await raw.readUnicodeString(['Root Entry', '__substg1.0_0037001E']);

        const bodyText = await raw.readUnicodeString(['Root Entry', '__substg1.0_1000001F'])
            ?? await raw.readUnicodeString(['Root Entry', '__substg1.0_1000001E']);

        const html = await raw.readUnicodeString(['Root Entry', '__substg1.0_1013001F'])
            ?? await raw.readUnicodeString(['Root Entry', '__substg1.0_1013001E']);

        const body: MsgBody = {
            ...(bodyText && { text: bodyText }),
            ...(html && { html }),
        };

        const rawAttachments = await raw.readAttachments();
        const attachments: MsgAttachment[] = rawAttachments.map((a, idx) => ({
            name: a.storageName,
            mime: 'application/octet-stream',
            content: Buffer.alloc(0)
        }));

        return {
            subject: subject ?? '',
            from: { name: '', email: '' },
            to: [],
            body,
            attachments
        };
    }
}
