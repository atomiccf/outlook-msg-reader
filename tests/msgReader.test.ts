import { describe, expect, it, vi } from 'vitest';
import type { CFBFReader } from '../src/cfb/CFBReader';
import type { AttachmentReader } from '../src/msg/AttachmentReader';
import type { BodyReader } from '../src/msg/BodyReader';
import type { MetadataReader } from '../src/msg/MetadataReader';
import { MsgReader } from '../src/msg/MsgReader';
import type { RecipientReader } from '../src/msg/RecipientReader';
import type { SenderReader } from '../src/msg/SenderReader';
import type { SubjectReader } from '../src/msg/SubjectReader';
import { DEFAULT_MAX_ATTACHMENTS, DEFAULT_MAX_RESULT_BYTES } from '../src/api/options';
import type { MsgDiagnostic } from '../src';

function createReader(bodyReader?: BodyReader) {
  const readAttachments = vi.fn(async () => [{
    index: 0,
    name: 'x',
    mime: '',
    size: 4,
    kind: 'file' as const,
    content: Buffer.alloc(4),
  }]);
  const reader = new MsgReader(
    {} as CFBFReader,
    { read: vi.fn(async () => 'Hi') } as unknown as SubjectReader,
    bodyReader ?? { read: vi.fn(async () => ({ text: 'Hello' })) } as unknown as BodyReader,
    { read: vi.fn(async () => ({ name: '', email: '' })) } as unknown as SenderReader,
    { read: vi.fn(async () => ({ to: [] })) } as unknown as RecipientReader,
    { readAttachments } as unknown as AttachmentReader,
    { read: vi.fn(async () => ({})) } as unknown as MetadataReader,
  );
  return { reader, readAttachments };
}

describe('MsgReader result limits', () => {
  it('applies default result and attachment-count limits', async () => {
    const { reader, readAttachments } = createReader();
    reader.configure({});

    await reader.getAttachments();
    expect(readAttachments).toHaveBeenCalledWith(
      undefined,
      DEFAULT_MAX_RESULT_BYTES,
      DEFAULT_MAX_ATTACHMENTS,
    );
  });

  it('counts body strings and attachment bytes in one result limit', async () => {
    const { reader, readAttachments } = createReader();
    reader.configure({ maxResultBytes: 15 });

    await expect(reader.parse()).rejects.toThrow('MSG result exceeds maxResultBytes (15)');
    expect(readAttachments).toHaveBeenCalledWith(undefined, 15, DEFAULT_MAX_ATTACHMENTS, 7);
  });

  it('accepts a result exactly at the limit', async () => {
    const { reader } = createReader();
    reader.configure({ maxResultBytes: 16 });

    await expect(reader.parse()).resolves.toMatchObject({ subject: 'Hi', body: { text: 'Hello' } });
  });

  it('includes diagnostic strings in the result budget', async () => {
    const diagnostic: MsgDiagnostic = { code: 'RTF_DECODE_FAILED', message: 'Invalid RTF' };
    const bodyReader = {
      read: async (
        _maxRtfBytes?: number,
        _maxResultBytes?: number,
        _existingResultBytes?: number,
        onDiagnostic?: (value: MsgDiagnostic) => void,
      ) => {
        onDiagnostic?.(diagnostic);
        return { text: 'Hello' };
      },
    } as unknown as BodyReader;
    const { reader } = createReader(bodyReader);
    const exactBudget = 16 + Buffer.byteLength(diagnostic.code) + Buffer.byteLength(diagnostic.message);

    reader.configure({ maxResultBytes: exactBudget - 1 });
    await expect(reader.parse()).rejects.toThrow('MSG result exceeds maxResultBytes');
    reader.configure({ maxResultBytes: exactBudget });
    await expect(reader.parse()).resolves.toMatchObject({ diagnostics: [diagnostic] });
  });

  it.each(['maxAttachments', 'maxRecipients', 'maxResultBytes'] as const)(
    'rejects invalid %s', (option) => {
      const { reader } = createReader();
      expect(() => reader.configure({ [option]: -1 })).toThrow(
        `${option} must be a non-negative safe integer`,
      );
    },
  );
});
