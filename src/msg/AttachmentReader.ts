import type { CFBFReader } from '../cfb/CFBReader';
import type { PropertyStore } from '../mapi/PropertyStore';
import type { PropertyStreamReader } from '../mapi/PropertyStreamReader';
import type { Msg, MsgAttachment, MsgAttachmentInfo, MsgAttachmentStream } from '../types';
import type { MsgReader } from './MsgReader';
import { DEFAULT_MAX_EMBEDDED_MESSAGE_DEPTH } from '../api/options';
import { UnsupportedMsgFeatureError } from '../errors/errors';

export type EmbeddedMessageReaderFactory = (rootStorage: string[]) => MsgReader;

type AttachmentEntry = {
  info: MsgAttachmentInfo;
  storagePath: string[];
  dataPath: string[];
};

export class AttachmentReader {
  private attachmentStorages?: string[][];
  private attachmentEntries?: Promise<AttachmentEntry[]>;
  constructor(
    private readonly cfbReader: CFBFReader,
    private readonly properties: PropertyStore,
    private readonly propertyStream: PropertyStreamReader,
    private readonly createEmbeddedReader?: EmbeddedMessageReaderFactory,
    private readonly embeddedMessageDepth = 0,
  ) {}

  async readAttachments(
    maxAttachmentBytes?: number,
    maxResultBytes?: number,
    maxAttachments?: number,
    existingResultBytes = 0,
  ): Promise<MsgAttachment[]> {
    const attachments: MsgAttachment[] = [];
    const entries = await this.readAttachmentEntries(maxAttachments);
    let resultBytes = existingResultBytes;
    for (const { info } of entries) {
      const entryBytes = Buffer.byteLength(info.name) + Buffer.byteLength(info.mime)
        + Buffer.byteLength(info.kind)
        + (info.kind === 'file' ? info.size : 0);
      if (maxResultBytes !== undefined && entryBytes > maxResultBytes - resultBytes) {
        throw new RangeError(`MSG result exceeds maxResultBytes (${maxResultBytes})`);
      }
      resultBytes += entryBytes;
    }
    for (const { info, dataPath } of entries) {
      if (info.kind === 'embedded-message') {
        attachments.push({ ...info, kind: 'embedded-message' });
        continue;
      }
      if (
        maxAttachmentBytes !== undefined &&
        info.size > maxAttachmentBytes
      ) {
        throw new RangeError(
          `Attachment "${info.name}" exceeds maxAttachmentBytes (${maxAttachmentBytes})`,
        );
      }
      const data = await this.cfbReader.readStream(dataPath);
      if (!data) throw new Error(`Attachment content stream is missing: ${info.name}`);
      if (maxAttachmentBytes !== undefined && data.length > maxAttachmentBytes) {
        throw new RangeError(`Attachment "${info.name}" exceeds maxAttachmentBytes (${maxAttachmentBytes})`);
      }
      if (maxResultBytes !== undefined && data.length - info.size > maxResultBytes - resultBytes) {
        throw new RangeError(`MSG result exceeds maxResultBytes (${maxResultBytes})`);
      }
      resultBytes += data.length - info.size;
      attachments.push({
        ...info,
        content: data,
        kind: 'file',
      });
    }
    return attachments;
  }

  async readAttachmentInfos(maxAttachments?: number): Promise<MsgAttachmentInfo[]> {
    return (await this.readAttachmentEntries(maxAttachments)).map(({ info }) => ({ ...info }));
  }

  async openAttachment(index: number, maxAttachments?: number): Promise<MsgAttachmentStream> {
    const entry = (await this.readAttachmentEntries(maxAttachments)).find(({ info }) => info.index === index);
    if (!entry) throw new RangeError(`Attachment index out of range: ${index}`);
    if (entry.info.kind !== 'file') {
      throw new TypeError('Embedded message attachments do not expose a binary content stream');
    }
    const content = await this.cfbReader.openStream(entry.dataPath);
    if (!content) throw new Error(`Attachment content stream is missing: ${entry.info.name}`);
    return { ...entry.info, kind: 'file', content };
  }

  async readEmbeddedMessage(
    index: number,
    maxAttachmentBytes?: number,
    maxRtfBytes?: number,
    maxEmbeddedMessageDepth = DEFAULT_MAX_EMBEDDED_MESSAGE_DEPTH,
    maxResultBytes?: number,
    maxAttachments?: number,
    maxRecipients?: number,
    signal?: AbortSignal,
  ): Promise<Msg> {
    const entry = (await this.readAttachmentEntries(maxAttachments)).find(({ info }) => info.index === index);
    if (!entry) throw new RangeError(`Attachment index out of range: ${index}`);
    if (entry.info.kind !== 'embedded-message') {
      throw new TypeError(`Attachment is not an embedded message: ${entry.info.name}`);
    }
    if (!this.createEmbeddedReader) {
      throw new Error('Embedded message parsing dependencies are unavailable');
    }
    if (!Number.isSafeInteger(maxEmbeddedMessageDepth) || maxEmbeddedMessageDepth < 0) {
      throw new RangeError('maxEmbeddedMessageDepth must be a non-negative safe integer');
    }
    if (this.embeddedMessageDepth >= maxEmbeddedMessageDepth) {
      throw new RangeError(
        `Embedded message depth exceeds maxEmbeddedMessageDepth (${maxEmbeddedMessageDepth})`,
      );
    }

    const rootStorage = [...entry.storagePath, '__substg1.0_3701000D'];
    const reader = this.createEmbeddedReader(rootStorage);
    reader.configure({ maxAttachmentBytes, maxRtfBytes, maxEmbeddedMessageDepth, maxResultBytes, maxAttachments, maxRecipients, signal });
    return reader.parse();
  }

  private async readAttachmentEntries(maxAttachments?: number): Promise<AttachmentEntry[]> {
    const storages = this.attachmentStorages ??= this.properties.findStorages('__attach_version1.0_');
    if (maxAttachments !== undefined && storages.length > maxAttachments) {
      throw new RangeError(`MSG has more than maxAttachments (${maxAttachments})`);
    }
    this.attachmentEntries ??= this.loadAttachmentEntries(storages).catch((error: unknown) => {
      this.attachmentEntries = undefined;
      throw error;
    });
    return this.attachmentEntries;
  }

  private async loadAttachmentEntries(storages: string[][]): Promise<AttachmentEntry[]> {
    const result: AttachmentEntry[] = [];
    for (let index = 0; index < storages.length; index++) {
      const storagePath = storages[index];
      const method = await this.propertyStream.readNumber(storagePath, ['3705']);
      if (method !== 1 && method !== 5) {
        throw new UnsupportedMsgFeatureError(
          `Unsupported attachment method ${method ?? 'missing'} at index ${index}`,
        );
      }
      const kind = method === 5 ? 'embedded-message' : 'file';
      const dataPath = [...storagePath, '__substg1.0_37010102'];
      const name = await this.properties.readStringAt(storagePath, ['3707', '3704']);
      const mime = await this.properties.readStringAt(storagePath, ['370E']);
      result.push({
        storagePath,
        dataPath,
        info: {
          index,
          name: name ?? `attachment_${index + 1}`,
          mime: mime ?? 'application/octet-stream',
          size: kind === 'file' ? this.cfbReader.getStreamSize(dataPath) ?? 0 : 0,
          kind,
        },
      });
    }
    return result;
  }
}
