import type { CFBFReader } from '../cfb/CFBReader';
import type { Msg, MsgBody, MsgMetadata, MsgRecipient } from '../types';
import type { AttachmentReader } from './AttachmentReader';
import type { BodyReader } from './BodyReader';
import type { RecipientReader, Recipients } from './RecipientReader';
import type { SenderReader } from './SenderReader';
import type { SubjectReader } from './SubjectReader';
import type { MetadataReader } from './MetadataReader';

/** Coordinates the specialized readers for one scoped MSG session. */
export class MsgReader {
  constructor(
    private readonly cfbReader: CFBFReader,
    private readonly subjectReader: SubjectReader,
    private readonly bodyReader: BodyReader,
    private readonly senderReader: SenderReader,
    private readonly recipientReader: RecipientReader,
    private readonly attachmentReader: AttachmentReader,
    private readonly metadataReader?: MetadataReader,
  ) {}

  async parse(): Promise<Msg> {
    const subject = await this.getSubject();
    const body = await this.getBody();
    const from = await this.getFrom();
    const recipients = await this.getRecipients();
    const attachments = await this.getAttachments();
    const metadata = await this.getMetadata();
    return {
      subject,
      body,
      from,
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
      attachments,
      metadata,
    };
  }

  getSubject(): Promise<string> { return this.subjectReader.read(); }
  getBody(): Promise<MsgBody> { return this.bodyReader.read(); }
  getFrom(): Promise<MsgRecipient> { return this.senderReader.read(); }
  getRecipients(): Promise<Recipients> { return this.recipientReader.read(); }
  getAttachments() { return this.attachmentReader.readAttachments(); }
  getMetadata(): Promise<MsgMetadata> { return this.metadataReader?.read() ?? Promise.resolve({}); }

  /** Advanced access to the isolated compound-file reader for this message. */
  getCFBReader(): CFBFReader { return this.cfbReader; }

  /** Releases resources retained by stream-backed input. */
  close(): Promise<void> { return this.cfbReader.close(); }

  async [Symbol.asyncDispose](): Promise<void> { await this.close(); }
}
