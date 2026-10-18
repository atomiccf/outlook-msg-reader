import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { CFBFReader } from '../src/cfb/CFBReader';
import { PropertyStore } from '../src/mapi/PropertyStore';
import type { PropertyStreamReader } from '../src/mapi/PropertyStreamReader';
import { PropertyReader } from '../src/mapi/PropertyReader';
import type { CodePageReader } from '../src/mapi/CodePageReader';
import { AttachmentReader } from '../src/msg/AttachmentReader';
import type { NamedPropertyReader } from '../src/mapi/NamedPropertyReader';
import { DirectoryEntryType, type DirectoryNode } from '../src/types';
import { Decoder } from '../src/encoding/decoder';
import { NoopLogger } from '../src/logging/Logger';
import { createMessageReader } from '../src/msg/createMessageReader';
import { UnsupportedMsgFeatureError } from '../src/errors/errors';

function node(name: string, type: DirectoryEntryType, children: DirectoryNode[] = []): DirectoryNode {
  return {
    sid: 0,
    name,
    type,
    startingSectorLocation: 0,
    streamSize: 0,
    children,
    parentSid: null,
  };
}

describe('AttachmentReader streaming', () => {
  it('reuses attachment metadata across listing and opening attachments', async () => {
    const storages = Array.from({ length: 24 }, (_, index) => [
      'Root Entry', `__attach_version1.0_#${index.toString(16).padStart(8, '0')}`,
    ]);
    const findStorages = vi.fn(() => storages);
    const readStringAt = vi.fn(async (path: string[], ids: string[]) =>
      ids[0] === '3707' ? path[1] : undefined);
    const readNumber = vi.fn(async () => 1);
    const openStream = vi.fn(async () => Readable.from([Buffer.from('data')]));
    const reader = new AttachmentReader(
      { getStreamSize: () => 4, openStream } as unknown as CFBFReader,
      { findStorages, readStringAt } as unknown as PropertyStore,
      { readNumber } as unknown as PropertyStreamReader,
    );

    const infos = await reader.readAttachmentInfos();
    infos[0].name = 'changed by caller';
    for (let index = 0; index < storages.length; index++) {
      const attachment = await reader.openAttachment(index);
      expect(attachment.name).toBe(storages[index][1]);
    }
    await expect(reader.readAttachmentInfos(1)).rejects.toThrow('MSG has more than maxAttachments (1)');
    expect(findStorages).toHaveBeenCalledTimes(1);
    expect(readNumber).toHaveBeenCalledTimes(storages.length);
    expect(readStringAt).toHaveBeenCalledTimes(storages.length * 2);
    expect(openStream).toHaveBeenCalledTimes(storages.length);
  });

  it('rejects too many attachments before reading their properties', async () => {
    const readStringAt = vi.fn(async () => 'name');
    const reader = new AttachmentReader(
      {} as CFBFReader,
      {
        findStorages: () => [
          ['Root Entry', '__attach_version1.0_#00000000'],
          ['Root Entry', '__attach_version1.0_#00000001'],
        ],
        readStringAt,
      } as unknown as PropertyStore,
      {} as PropertyStreamReader,
    );

    await expect(reader.readAttachments(undefined, undefined, 1))
      .rejects.toThrow('MSG has more than maxAttachments (1)');
    await expect(reader.readAttachmentInfos(1))
      .rejects.toThrow('MSG has more than maxAttachments (1)');
    expect(readStringAt).not.toHaveBeenCalled();
  });

  it('limits the combined attachment payload before reading file content', async () => {
    const readStream = vi.fn(async () => Buffer.alloc(4));
    const reader = new AttachmentReader(
      { readStream, getStreamSize: () => 4 } as unknown as CFBFReader,
      {
        findStorages: () => [
          ['Root Entry', '__attach_version1.0_#00000000'],
          ['Root Entry', '__attach_version1.0_#00000001'],
        ],
        readStringAt: vi.fn(async (_path: string[], ids: string[]) =>
          ids[0] === '3707' ? 'x' : ''),
      } as unknown as PropertyStore,
      { readNumber: vi.fn(async () => 1) } as unknown as PropertyStreamReader,
    );

    await expect(reader.readAttachments(undefined, 17))
      .rejects.toThrow('MSG result exceeds maxResultBytes (17)');
    expect(readStream).not.toHaveBeenCalled();
    await expect(reader.readAttachments(undefined, 18)).resolves.toHaveLength(2);
    expect(readStream).toHaveBeenCalledTimes(2);
  });

  it.each([0, 2, 3, 4, 6, 7, 99, undefined])(
    'rejects unsupported attachment method %s', async (method) => {
      const readStream = vi.fn(async () => Buffer.from('data'));
      const reader = new AttachmentReader(
        { readStream, getStreamSize: () => 4 } as unknown as CFBFReader,
        {
          findStorages: () => [['Root Entry', '__attach_version1.0_#00000000']],
          readStringAt: vi.fn(async () => 'attachment'),
        } as unknown as PropertyStore,
        { readNumber: vi.fn(async () => method) } as unknown as PropertyStreamReader,
      );

      await expect(reader.readAttachments()).rejects.toThrow(UnsupportedMsgFeatureError);
      await expect(reader.readAttachmentInfos()).rejects.toThrow(
        `Unsupported attachment method ${method ?? 'missing'} at index 0`,
      );
      expect(readStream).not.toHaveBeenCalled();
    },
  );

  it('rejects a missing file content stream in both reading modes', async () => {
    const attachmentStorage = ['Root Entry', '__attach_version1.0_#00000000'];
    const reader = new AttachmentReader(
      {
        readStream: vi.fn(async () => null),
        openStream: vi.fn(async () => null),
        getStreamSize: () => null,
      } as unknown as CFBFReader,
      {
        findStorages: () => [attachmentStorage],
        readStringAt: vi.fn(async () => 'missing.bin'),
      } as unknown as PropertyStore,
      { readNumber: vi.fn(async () => 1) } as unknown as PropertyStreamReader,
    );

    await expect(reader.readAttachments()).rejects.toThrow('Attachment content stream is missing: missing.bin');
    await expect(reader.openAttachment(0)).rejects.toThrow('Attachment content stream is missing: missing.bin');
  });

  it('keeps an existing empty file attachment', async () => {
    const reader = new AttachmentReader(
      {
        readStream: vi.fn(async () => Buffer.alloc(0)),
        getStreamSize: () => 0,
      } as unknown as CFBFReader,
      {
        findStorages: () => [['Root Entry', '__attach_version1.0_#00000000']],
        readStringAt: vi.fn(async () => 'empty.bin'),
      } as unknown as PropertyStore,
      { readNumber: vi.fn(async () => 1) } as unknown as PropertyStreamReader,
    );

    await expect(reader.readAttachments()).resolves.toMatchObject([{ content: Buffer.alloc(0) }]);
  });

  it('lists attachment metadata without reading its content', async () => {
    const contentPath = [
      'Root Entry',
      '__attach_version1.0_#00000000',
      '__substg1.0_37010102',
    ];
    const readStream = vi.fn(async () => null);
    const openStream = vi.fn(async () => Readable.from([Buffer.from('content')]));
    const reader = new AttachmentReader(
      {
        readStream,
        openStream,
        getStreamSize: (path: string[]) => path.join('/') === contentPath.join('/') ? 7 : null,
      } as unknown as CFBFReader,
      {
        findStorages: () => [['Root Entry', '__attach_version1.0_#00000000']],
        readStringAt: vi.fn(async (_path: string[], ids: string[]) =>
          ids[0] === '3707' ? 'large.bin' : 'application/octet-stream'),
      } as unknown as PropertyStore,
      { readNumber: vi.fn(async () => 1) } as unknown as PropertyStreamReader,
    );

    await expect(reader.readAttachmentInfos()).resolves.toEqual([{
      index: 0,
      name: 'large.bin',
      mime: 'application/octet-stream',
      size: 7,
      kind: 'file',
    }]);
    expect(readStream).not.toHaveBeenCalledWith(contentPath);
    expect(openStream).not.toHaveBeenCalled();

    const attachment = await reader.openAttachment(0);
    const chunks: Buffer[] = [];
    for await (const chunk of attachment.content) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('content');
    expect(openStream).toHaveBeenCalledWith(contentPath);
  });

  it('rejects oversized attachments before reading their content into a Buffer', async () => {
    const readStream = vi.fn(async () => null);
    const reader = new AttachmentReader(
      { readStream, getStreamSize: () => 1024 } as unknown as CFBFReader,
      {
        findStorages: () => [['Root Entry', '__attach_version1.0_#00000000']],
        readStringAt: vi.fn(async (_path: string[], ids: string[]) =>
          ids[0] === '3707' ? 'large.bin' : undefined),
      } as unknown as PropertyStore,
      { readNumber: vi.fn(async () => 1) } as unknown as PropertyStreamReader,
    );

    await expect(reader.readAttachments(100)).rejects.toThrow('exceeds maxAttachmentBytes (100)');
    expect(readStream).not.toHaveBeenCalledWith([
      'Root Entry',
      '__attach_version1.0_#00000000',
      '__substg1.0_37010102',
    ]);
  });

  it('reads attachment names and MIME types from ANSI properties', async () => {
    const attachmentStorage = ['Root Entry', '__attach_version1.0_#00000000'];
    const dataPath = [...attachmentStorage, '__substg1.0_37010102'];
    const tree = node('Root Entry', DirectoryEntryType.Root, [
      node('__attach_version1.0_#00000000', DirectoryEntryType.Storage, [
        node('__substg1.0_3707001E', DirectoryEntryType.Stream),
        node('__substg1.0_370E001E', DirectoryEntryType.Stream),
        node('__substg1.0_37010102', DirectoryEntryType.Stream),
      ]),
    ]);
    const cfbReader = {
      getTree: () => tree,
      readStream: vi.fn(async (path: string[]) => {
        const name = path[path.length - 1];
        if (name === '__substg1.0_3707001E') return Buffer.from('report.txt\0', 'latin1');
        if (name === '__substg1.0_370E001E') return Buffer.from('text/plain\0', 'latin1');
        return null;
      }),
      getStreamSize: (path: string[]) => path.join('/') === dataPath.join('/') ? 7 : null,
    } as unknown as CFBFReader;
    const propertyReader = new PropertyReader(
      cfbReader,
      new Decoder(),
      { getCodepage: vi.fn(async () => 1252) } as unknown as CodePageReader,
    );
    const properties = new PropertyStore(
      cfbReader,
      propertyReader,
      {} as NamedPropertyReader,
    );
    const reader = new AttachmentReader(
      cfbReader,
      properties,
      { readNumber: vi.fn(async () => 1) } as unknown as PropertyStreamReader,
    );

    await expect(reader.readAttachmentInfos()).resolves.toEqual([{
      index: 0,
      name: 'report.txt',
      mime: 'text/plain',
      size: 7,
      kind: 'file',
    }]);
  });

  it('parses an embedded message from its attachment storage', async () => {
    const attachmentStorage = ['Root Entry', '__attach_version1.0_#00000000'];
    const embeddedStorage = [...attachmentStorage, '__substg1.0_3701000D'];
    const subjectPath = [...embeddedStorage, '__substg1.0_0037001F'];
    const tree = node('Root Entry', DirectoryEntryType.Root, [
      node('__attach_version1.0_#00000000', DirectoryEntryType.Storage, [
        node('__substg1.0_3701000D', DirectoryEntryType.Storage, [
          node('__substg1.0_0037001F', DirectoryEntryType.Stream),
        ]),
      ]),
    ]);
    const cfbReader = {
      getTree: () => tree,
      readStream: vi.fn(async (path: string[]) => {
        if (path.join('/') === subjectPath.join('/')) return Buffer.from('Nested subject\0', 'utf16le');
        return null;
      }),
      getStreamSize: () => null,
    } as unknown as CFBFReader;
    const dependencies = {
      cfbReader,
      decoder: new Decoder(),
      logger: new NoopLogger(),
      namedProperties: {
        initialize: vi.fn(),
        getPropertyId: vi.fn(),
      } as unknown as NamedPropertyReader,
    };
    const reader = new AttachmentReader(
      cfbReader,
      {
        findStorages: () => [attachmentStorage],
        readStringAt: vi.fn(async (_path: string[], ids: string[]) =>
          ids[0] === '3707' ? 'nested.msg' : undefined),
      } as unknown as PropertyStore,
      { readNumber: vi.fn(async () => 5) } as unknown as PropertyStreamReader,
      (rootStorage) => createMessageReader(dependencies, rootStorage),
    );

    await expect(reader.readAttachments()).resolves.toEqual([{
      index: 0,
      name: 'nested.msg',
      mime: 'application/octet-stream',
      size: 0,
      kind: 'embedded-message',
    }]);
    const message = await reader.readEmbeddedMessage(0);
    expect(message.subject).toBe('Nested subject');
    expect(message.attachments).toEqual([]);
  });

  it('rejects embedded messages beyond the configured depth', async () => {
    const attachmentStorage = ['Root Entry', '__attach_version1.0_#00000000'];
    const createEmbeddedReader = vi.fn();
    const reader = new AttachmentReader(
      { readStream: vi.fn(async () => null), getStreamSize: () => null } as unknown as CFBFReader,
      {
        findStorages: () => [attachmentStorage],
        readStringAt: vi.fn(async () => undefined),
      } as unknown as PropertyStore,
      { readNumber: vi.fn(async () => 5) } as unknown as PropertyStreamReader,
      createEmbeddedReader,
      1,
    );

    await expect(reader.readEmbeddedMessage(0, undefined, undefined, 1)).rejects.toThrow(
      'Embedded message depth exceeds maxEmbeddedMessageDepth (1)',
    );
    expect(createEmbeddedReader).not.toHaveBeenCalled();
  });
});
