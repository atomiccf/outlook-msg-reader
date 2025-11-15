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

export async function parseMsg(buffer: Buffer): Promise<Msg> {
    const mail = buffer
    console.info(mail)
    return {
        subject: 'Test email',
        from: { name: 'Sender', email: 'sender@example.com' },
        to: [{ name: 'Receiver', email: 'receiver@example.com' }],
        body: { text: 'Hello, world!' },
        attachments: [],
    };
}
