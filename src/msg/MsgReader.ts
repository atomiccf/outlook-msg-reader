import type { CFBFReader } from '../cfb/CFBReader';
import type { Msg, MsgBody, MsgMetadata, MsgRecipient } from '../types';
import type { AttachmentReader } from './AttachmentReader';
import type { BodyReader } from './BodyReader';
import type { RecipientReader, Recipients } from './RecipientReader';
import type { SenderReader } from './SenderReader';
import type { SubjectReader } from './SubjectReader';
import type { MetadataReader } from './MetadataReader';
import {
  DEFAULT_MAX_ATTACHMENTS,
  DEFAULT_MAX_EMBEDDED_MESSAGE_DEPTH,
  DEFAULT_MAX_RESULT_BYTES,
  type MsgReaderOptions,
} from '../api/options';

/** Coordinates the specialized readers for one scoped MSG session. */
export class MsgReader {
  private maxAttachmentBytes?: number;
  private maxAttachments = DEFAULT_MAX_ATTACHMENTS;
  private maxResultBytes = DEFAULT_MAX_RESULT_BYTES;
  private maxRtfBytes?: number;
  private maxEmbeddedMessageDepth = DEFAULT_MAX_EMBEDDED_MESSAGE_DEPTH;

  constructor(
    private readonly cfbReader: CFBFReader,
    private readonly subjectReader: SubjectReader,
    private readonly bodyReader: BodyReader,
    private readonly senderReader: SenderReader,
    private readonly recipientReader: RecipientReader,
    private readonly attachmentReader: AttachmentReader,
    private readonly metadataReader?: MetadataReader,
  ) {}

  configure(options: MsgReaderOptions): void {
    if (
      options.maxAttachmentBytes !== undefined &&
      (!Number.isSafeInteger(options.maxAttachmentBytes) || options.maxAttachmentBytes < 0)
    ) {
      throw new RangeError('maxAttachmentBytes must be a non-negative safe integer');
    }
    if (
      options.maxAttachments !== undefined &&
      (!Number.isSafeInteger(options.maxAttachments) || options.maxAttachments < 0)
    ) {
      throw new RangeError('maxAttachments must be a non-negative safe integer');
    }
    if (
      options.maxResultBytes !== undefined &&
      (!Number.isSafeInteger(options.maxResultBytes) || options.maxResultBytes < 0)
    ) {
      throw new RangeError('maxResultBytes must be a non-negative safe integer');
    }
    if (
      options.maxRtfBytes !== undefined &&
      (!Number.isSafeInteger(options.maxRtfBytes) || options.maxRtfBytes < 0)
    ) {
      throw new RangeError('maxRtfBytes must be a non-negative safe integer');
    }
    if (
      options.maxEmbeddedMessageDepth !== undefined &&
      (!Number.isSafeInteger(options.maxEmbeddedMessageDepth) || options.maxEmbeddedMessageDepth < 0)
    ) {
      throw new RangeError('maxEmbeddedMessageDepth must be a non-negative safe integer');
    }
    this.maxAttachmentBytes = options.maxAttachmentBytes;
    this.maxAttachments = options.maxAttachments ?? DEFAULT_MAX_ATTACHMENTS;
    this.maxResultBytes = options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;
    this.maxRtfBytes = options.maxRtfBytes;
    this.maxEmbeddedMessageDepth =
      options.maxEmbeddedMessageDepth ?? DEFAULT_MAX_EMBEDDED_MESSAGE_DEPTH;
  }

  async parse(): Promise<Msg> {
    let remaining = this.maxResultBytes;
    const charge = (value: unknown): void => {
      if (remaining === undefined || value === null || value === undefined) return;
      if (typeof value === 'string' || Buffer.isBuffer(value)) {
        const bytes = typeof value === 'string' ? Buffer.byteLength(value) : value.length;
        if (bytes > remaining) {
          throw new RangeError(`MSG result exceeds maxResultBytes (${this.maxResultBytes})`);
        }
        remaining -= bytes;
      } else if (Array.isArray(value)) {
        for (const item of value) charge(item);
      } else if (typeof value === 'object') {
        for (const item of Object.values(value)) charge(item);
      }
    };
    const subject = await this.getSubject();
    charge(subject);
    const body = await this.bodyReader.read(
      this.maxRtfBytes,
      this.maxResultBytes,
      this.maxResultBytes - remaining,
    );
    charge(body);
    const from = await this.getFrom();
    charge(from);
    const recipients = await this.getRecipients();
    charge(recipients);
    const usedResultBytes = this.maxResultBytes !== undefined && remaining !== undefined
      ? this.maxResultBytes - remaining
      : 0;
    const attachments = await this.attachmentReader.readAttachments(
      this.maxAttachmentBytes,
      this.maxResultBytes,
      this.maxAttachments,
      usedResultBytes,
    );
    charge(attachments);
    const metadata = await this.getMetadata();
    charge(metadata);
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
  getBody(): Promise<MsgBody> { return this.bodyReader.read(this.maxRtfBytes, this.maxResultBytes); }
  getFrom(): Promise<MsgRecipient> { return this.senderReader.read(); }
  getRecipients(): Promise<Recipients> { return this.recipientReader.read(); }
  getAttachments() {
    return this.attachmentReader.readAttachments(this.maxAttachmentBytes, this.maxResultBytes, this.maxAttachments);
  }
  getAttachmentInfos() { return this.attachmentReader.readAttachmentInfos(this.maxAttachments); }
  openAttachment(index: number) { return this.attachmentReader.openAttachment(index, this.maxAttachments); }
  getEmbeddedMessage(index: number): Promise<Msg> {
    return this.attachmentReader.readEmbeddedMessage(
      index,
      this.maxAttachmentBytes,
      this.maxRtfBytes,
      this.maxEmbeddedMessageDepth,
      this.maxResultBytes,
      this.maxAttachments,
    );
  }
  getMetadata(): Promise<MsgMetadata> { return this.metadataReader?.read() ?? Promise.resolve({}); }

  /** Advanced access to the isolated compound-file reader for this message. */
  getCFBReader(): CFBFReader { return this.cfbReader; }

  /** Releases resources retained by stream-backed input. */
  close(): Promise<void> { return this.cfbReader.close(); }

  async [Symbol.asyncDispose](): Promise<void> { await this.close(); }
}
