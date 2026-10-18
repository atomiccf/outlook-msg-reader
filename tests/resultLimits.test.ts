import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createMsgReader, parseMsg, type Msg } from '../src';

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/valid/outlook');

function resultBytes(message: Msg): number {
  const strings = [
    message.subject,
    ...Object.values(message.body),
    ...[message.from, ...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])]
      .flatMap(recipient => [recipient.name, recipient.email]),
    ...message.attachments.flatMap(attachment => [attachment.name, attachment.mime, attachment.kind]),
    message.metadata?.messageId,
    message.metadata?.transportHeaders,
    message.metadata?.importance,
  ];
  return strings.reduce((total, value) => total + Buffer.byteLength(value ?? '', 'utf8'), 0)
    + message.attachments.reduce((total, attachment) =>
      total + (attachment.kind === 'file' ? attachment.content.length : 0), 0);
}

describe('public parsed result budget', () => {
  it.each([
    'empty-unicode',
    'plain-basic-unicode',
    'unicode-polish-russian',
    'ansi-polish',
    'ansi-russian',
    'rtf-unicode',
    'small-attachment',
    'embedded-message',
  ])('counts returned payload rather than source streams for %s', async (fixture) => {
    const input = readFileSync(resolve(fixtureRoot, `${fixture}.msg`));
    const expected = await parseMsg(input);
    const maxResultBytes = resultBytes(expected);

    await expect(parseMsg(input, { maxResultBytes })).resolves.toEqual(expected);
    await expect(parseMsg(Readable.from([input]), { maxResultBytes })).resolves.toEqual(expected);
    await expect(parseMsg(input, { maxResultBytes: maxResultBytes - 1 }))
      .rejects.toBeInstanceOf(RangeError);
  });

  it('applies the result budget to an embedded message independently', async () => {
    const input = resolve(fixtureRoot, 'embedded-message.msg');
    const reader = await createMsgReader(input);
    let expected: Msg;
    try {
      expected = await reader.getEmbeddedMessage(0);
    } finally {
      await reader.close();
    }

    const maxResultBytes = resultBytes(expected);
    const bounded = await createMsgReader(input, { maxResultBytes });
    try {
      await expect(bounded.getEmbeddedMessage(0)).resolves.toEqual(expected);
      bounded.configure({ maxResultBytes: maxResultBytes - 1 });
      await expect(bounded.getEmbeddedMessage(0)).rejects.toBeInstanceOf(RangeError);
    } finally {
      await bounded.close();
    }
  });
});
