import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMsgReader, parseMsg, type MsgDiagnostic } from '../src';

const fixture = (name: string): string =>
  resolve(import.meta.dirname, 'fixtures/valid/outlook', `${name}.msg`);
const rtfDiagnostic: MsgDiagnostic = {
  code: 'RTF_DECODE_FAILED',
  message: 'Unable to decompress RTF body',
};

function corruptedRtf(): Buffer {
  const data = readFileSync(fixture('rtf-unicode'));
  const signatureOffset = data.indexOf(Buffer.from('LZFu'));
  if (signatureOffset < 0) throw new Error('RTF fixture has no compressed RTF signature');
  data.writeUInt32LE(0, signatureOffset);
  return data;
}

describe('public diagnostics', () => {
  it('returns a diagnostic and the remaining body when RTF is corrupt', async () => {
    const original = await parseMsg(fixture('rtf-unicode'));
    const message = await parseMsg(corruptedRtf());

    expect(message.subject).toBe(original.subject);
    expect(message.body.text).toBe(original.body.text);
    expect(message.body.rtf).toBeUndefined();
    expect(message.diagnostics).toEqual([rtfDiagnostic]);
  });

  it('omits diagnostics for a successfully decoded body', async () => {
    const message = await parseMsg(fixture('rtf-unicode'));

    expect(message.body.rtf).toBeTruthy();
    expect(message).not.toHaveProperty('diagnostics');
  });

  it('collects diagnostics on demand without duplicates or mutable shared results', async () => {
    const reader = await createMsgReader(corruptedRtf());
    const other = await createMsgReader(fixture('rtf-unicode'));
    try {
      expect(reader.getDiagnostics()).toEqual([]);
      await reader.getSubject();
      expect(reader.getDiagnostics()).toEqual([]);

      await reader.getBody();
      const snapshot = reader.getDiagnostics();
      expect(snapshot).toEqual([rtfDiagnostic]);
      snapshot[0].message = 'Changed by caller';
      snapshot.length = 0;

      await reader.getBody();
      expect(reader.getDiagnostics()).toEqual([rtfDiagnostic]);
      const message = await reader.parse();
      expect(message.diagnostics).toEqual([rtfDiagnostic]);
      message.diagnostics![0].message = 'Changed parsed result';
      expect(reader.getDiagnostics()).toEqual([rtfDiagnostic]);

      await other.getBody();
      expect(other.getDiagnostics()).toEqual([]);
    } finally {
      await Promise.all([reader.close(), other.close()]);
    }
  });

  it('still rejects resource-limit failures without adding a recoverable diagnostic', async () => {
    const reader = await createMsgReader(fixture('rtf-unicode'), { maxRtfBytes: 0 });
    try {
      await expect(reader.getBody()).rejects.toThrow('maxRtfBytes (0)');
      expect(reader.getDiagnostics()).toEqual([]);
    } finally {
      await reader.close();
    }
  });

  it('still rejects cancellation with the original reason', async () => {
    const controller = new AbortController();
    const reader = await createMsgReader(corruptedRtf(), { signal: controller.signal });
    try {
      const reason = new Error('Read cancelled');
      controller.abort(reason);
      await expect(reader.getBody()).rejects.toBe(reason);
      expect(reader.getDiagnostics()).toEqual([]);
    } finally {
      await reader.close();
    }
  });
});
