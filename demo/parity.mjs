import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { bundle } from './build.mjs';
import { maxCalendarPreviewBytes, readCalendarPreview } from './calendar-preview.mjs';

const fixtureRoot = new URL('../tests/fixtures/valid/outlook/', import.meta.url);
const { fixtures } = JSON.parse(await readFile(new URL('manifest.json', fixtureRoot), 'utf8'));
const browser = await bundle('parse.mjs', {
  format: 'iife', globalName: 'demo', write: false,
});
const { parseMessageFile } = runInNewContext(browser.outputFiles[0].text + '\ndemo', {
  AbortController, TextDecoder,
});
const native = await build({
  entryPoints: ['./src/index.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, format: 'esm', platform: 'node', write: false,
});
const { parseMsg } = await import('data:text/javascript;base64,' + Buffer.from(native.outputFiles[0].text).toString('base64'));

function comparable(message) {
  return JSON.parse(JSON.stringify({
    ...message,
    attachments: message.attachments.map(({ content, ...rest }) => ({
      ...rest,
      sha256: content && createHash('sha256').update(content).digest('hex'),
    })),
  }));
}

for (const { file } of fixtures) {
  test(`browser bundle matches Node.js for ${file}`, async () => {
    const bytes = await readFile(new URL(file, fixtureRoot));
    const { fileName, fileSize, ...actual } = await parseMessageFile(new File([bytes], file));
    assert.equal(fileName, file);
    assert.equal(fileSize, bytes.length);
    assert.deepEqual(comparable(actual), comparable(await parseMsg(bytes)));
  });
}

test('rejects an invalid MSG file', async () => {
  await assert.rejects(parseMessageFile(new File([new Uint8Array(512)], 'invalid.msg')));
});

test('previews the original .ics attachment bytes', async () => {
  const message = await parseMsg(await readFile(new URL('ics-attachment.msg', fixtureRoot)));
  const calendar = readCalendarPreview(message.attachments[0].content);
  assert.equal(calendar.total, 1);
  assert.equal(calendar.events[0].title, 'Fixture appointment');
  assert.equal(calendar.events[0].start, '2017-02-13 15:00:00 UTC');
  assert.equal(calendar.events[0].end, '2017-02-13 18:00:00 UTC');
});

test('preserves all-day dates, time zones, folded text and recurring event markers', () => {
  const content = Buffer.from([
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'SUMMARY:First event', 'DTSTART;VALUE=DATE:20261126', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Second event', 'DTSTART;TZID=Europe/Minsk:20261126T140000',
    'DURATION:PT30M', 'LOCATION:Room\\, east', 'DESCRIPTION:Folded ', ' text',
    'RRULE:FREQ=WEEKLY', 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n'));
  const { total, events: [first, second] } = readCalendarPreview(content);
  assert.equal(total, 2);
  assert.equal(first.start, '2026-11-26');
  assert.equal(first.end, '2026-11-27');
  assert.equal(first.allDay, true);
  assert.equal(second.start, '2026-11-26 14:00:00 (Europe/Minsk)');
  assert.equal(second.end, '2026-11-26 14:30:00 (Europe/Minsk)');
  assert.equal(second.location, 'Room, east');
  assert.equal(second.description, 'Folded text');
  assert.equal(second.recurring, true);
});

test('distinguishes calendar days from elapsed hours across daylight saving changes', () => {
  const content = Buffer.from([
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calendar preview test//EN',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
    'BEGIN:STANDARD', 'DTSTART:20251026T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'END:STANDARD',
    'BEGIN:DAYLIGHT', 'DTSTART:20260329T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'DTSTART:20261025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT', 'UID:spring-hours', 'DTSTAMP:20260101T000000Z',
    'DTSTART;TZID=Europe/Berlin:20260329T013000', 'DURATION:PT2H', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:spring-day', 'DTSTAMP:20260101T000000Z',
    'DTSTART;TZID=Europe/Berlin:20260328T123000', 'DURATION:P1DT1H', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:fall-hours', 'DTSTAMP:20260101T000000Z',
    'DTSTART;TZID=Europe/Berlin:20261025T003000', 'DURATION:PT2H', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n'));
  assert.deepEqual(readCalendarPreview(content).events.map(event => event.end), [
    '2026-03-29 04:30:00 (Europe/Berlin)',
    '2026-03-29 13:30:00 (Europe/Berlin)',
    '2026-10-25 00:30:00 UTC',
  ]);
});

test('recognizes cancellation status regardless of letter case', () => {
  const content = Buffer.from([
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calendar preview test//EN',
    'BEGIN:VEVENT', 'UID:cancelled-test', 'DTSTAMP:20260101T000000Z',
    'DTSTART:20260102T100000Z', 'STATUS:cancelled', 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n'));
  assert.equal(readCalendarPreview(content).events[0].cancelled, true);
});

test('handles empty calendars and rejects invalid or oversized ones', () => {
  assert.deepEqual(readCalendarPreview(Buffer.from('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n')),
    { total: 0, events: [] });
  assert.throws(() => readCalendarPreview(Buffer.from('invalid')));
  assert.throws(() => readCalendarPreview(Buffer.alloc(maxCalendarPreviewBytes + 1)), RangeError);
});
