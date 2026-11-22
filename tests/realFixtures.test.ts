import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMsgReader, parseMsg } from '../src';

interface FixtureExpectation {
  dates?: Record<'sentAt' | 'receivedAt' | 'createdAt' | 'modifiedAt', string | null>;
  subject?: string;
  subjectContains?: string;
  textContains?: string;
  htmlContains?: string;
  rtfPresent?: boolean;
  toCount?: number;
  ccCount?: number;
  bccCount?: number;
  attachmentCount?: number;
  attachmentNames?: string[];
  attachmentKinds?: string[];
}

interface Fixture {
  id: string;
  file: string;
  sha256: string;
  msgFormat?: string;
  expected: FixtureExpectation;
}

const fixtureRoot = path.resolve(import.meta.dirname, 'fixtures/valid/outlook');
const manifest = JSON.parse(
  readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'),
) as { fixtures: Fixture[] };

describe('real MSG fixtures', () => {
  it('accounts for every fixture file and the Outlook-specific cases', () => {
    const files = readdirSync(fixtureRoot)
      .filter((file) => file.toLowerCase().endsWith('.msg'))
      .sort();
    expect(manifest.fixtures.map((fixture) => fixture.file).sort()).toEqual(files);
    expect(new Set(manifest.fixtures.map((fixture) => fixture.id)).size).toBe(manifest.fixtures.length);
    expect(manifest.fixtures.every((fixture) => /^[a-f0-9]{64}$/.test(fixture.sha256))).toBe(true);
    expect(manifest.fixtures.some((fixture) => fixture.msgFormat?.toLowerCase() === 'ansi')).toBe(true);
    expect(manifest.fixtures.some((fixture) =>
      fixture.expected.attachmentKinds?.includes('embedded-message'))).toBe(true);
  });

  it.each(manifest.fixtures)('parses $id', async (fixture) => {
    const filePath = path.join(fixtureRoot, fixture.file);
    const bytes = readFileSync(filePath);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);

    const message = await parseMsg(filePath);
    const expected = fixture.expected;
    if (expected.subject !== undefined) expect(message.subject).toBe(expected.subject);
    if (expected.subjectContains !== undefined) expect(message.subject).toContain(expected.subjectContains);
    if (expected.textContains !== undefined) expect(message.body.text).toContain(expected.textContains);
    if (expected.htmlContains !== undefined) expect(message.body.html).toContain(expected.htmlContains);
    if (expected.rtfPresent !== undefined) expect(Boolean(message.body.rtf)).toBe(expected.rtfPresent);
    if (expected.toCount !== undefined) expect(message.to).toHaveLength(expected.toCount);
    if (expected.ccCount !== undefined) expect(message.cc ?? []).toHaveLength(expected.ccCount);
    if (expected.bccCount !== undefined) expect(message.bcc ?? []).toHaveLength(expected.bccCount);
    if (expected.attachmentCount !== undefined) expect(message.attachments).toHaveLength(expected.attachmentCount);
    if (expected.attachmentNames !== undefined) {
      expect(message.attachments.map((item) => item.name)).toEqual(expected.attachmentNames);
    }
    if (expected.attachmentKinds !== undefined) {
      expect(message.attachments.map((item) => item.kind)).toEqual(expected.attachmentKinds);
    }
    if (expected.dates !== undefined) {
      const reader = await createMsgReader(filePath);
      try {
        const metadata = await reader.getMetadata();
        for (const key of ['sentAt', 'receivedAt', 'createdAt', 'modifiedAt'] as const) {
          const iso = expected.dates[key];
          const date = iso === null ? undefined : new Date(iso);
          expect(message.metadata?.[key], key).toEqual(date);
          expect(metadata[key], key).toEqual(date);
        }
      } finally {
        await reader.close();
      }
    }
  });

  it('reads the Outlook embedded message', async () => {
    const reader = await createMsgReader(path.join(fixtureRoot, 'embedded-message.msg'));
    try {
      const nested = await reader.getEmbeddedMessage(0);
      expect(nested.subject).toBe('Embedded child message');
      expect(nested.body.text).toContain('Embedded message body.');
    } finally {
      await reader.close();
    }
  });
});
