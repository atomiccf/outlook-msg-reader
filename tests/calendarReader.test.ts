import { describe, expect, it, vi } from 'vitest';
import { InvalidCfbfError, MsgError } from '../src';
import type { CFBFReader } from '../src/cfb/CFBReader';
import { Decoder } from '../src/encoding/decoder';
import { NoopLogger } from '../src/logging/Logger';
import { NamedPropertyReader } from '../src/mapi/NamedPropertyReader';
import { createMessageReader } from '../src/msg/createMessageReader';
import { DirectoryEntryType, type DirectoryNode } from '../src/types';

const names = '__nameid_version1.0';
const nameEntry = `${names}/__substg1.0_00030102`;
const fixed = '__properties_version1.0';
const attachment = '__attach_version1.0_#00000000';
const embedded = '__substg1.0_3701000D';
const start = new Date('2026-04-12T00:00:00.123Z');
const end = new Date('2026-04-13T00:00:00.000Z');
const fileTime = (date: Date) => (BigInt(date.getTime()) + 11_644_473_600_000n) * 10_000n;

function fixedStream(header: number, ...entries: [id: number, type: number, value: bigint][]): Buffer {
  const stream = Buffer.alloc(header + 16 * entries.length);
  entries.forEach(([id, type, value], index) => {
    const offset = header + index * 16;
    stream.writeUInt16LE(type, offset);
    stream.writeUInt16LE(id, offset + 2);
    stream.writeBigUInt64LE(value, offset + 8);
  });
  return stream;
}

function session(streams: Record<string, Buffer>, nameError?: Error) {
  const node = (name: string, type: DirectoryEntryType): DirectoryNode => ({
    name, type, sid: 0, startingSectorLocation: 0, streamSize: 0, children: [], parentSid: null,
  });
  const tree = node('Root Entry', DirectoryEntryType.Root);
  for (const path of Object.keys(streams)) {
    const segments = path.split('/');
    let parent = tree;
    for (const [index, segment] of segments.entries()) {
      let child = parent.children.find(item => item.name === segment);
      if (!child) {
        child = node(segment, index === segments.length - 1 ? DirectoryEntryType.Stream : DirectoryEntryType.Storage);
        parent.children.push(child);
      }
      parent = child;
    }
  }
  const readStream = vi.fn(async ([, ...path]: string[]) => {
    const key = path.join('/');
    if (key === nameEntry && nameError) throw nameError;
    return streams[key] ?? null;
  });
  const cfbReader = { getTree: () => tree, readStream } as unknown as CFBFReader;
  const logger = new NoopLogger();
  const namedProperties = new NamedPropertyReader(cfbReader, logger);
  return { reader: createMessageReader({ cfbReader, decoder: new Decoder(), logger, namedProperties }), readStream };
}

const unicode = (text: string) => Buffer.from(`${text}\0`, 'utf16le');
const classStream = '__substg1.0_001A001F';

describe('calendar metadata', () => {
  it.each([
    'IPM.Appointment', 'ipm.APPoIntment.Custom', 'IPM.Schedule.Meeting.Request',
    'IPM.Schedule.Meeting.Canceled', 'IPM.Schedule.Meeting.Resp.Pos',
  ])('recognizes %s in an ANSI property', async (messageClass) => {
    const { reader } = session({ '__substg1.0_001A001E': Buffer.from(` ${messageClass} \0`) });
    await expect(reader.getCalendar()).resolves.toEqual({ messageClass });
  });

  it.each(['IPM.Note', 'IPM.AppointmentExtra', 'IPM.Schedule.Meeting.Resp'])('skips NameID for %s', async (messageClass) => {
    const { reader, readStream } = session({ [classStream]: unicode(messageClass) });
    await expect(reader.getCalendar()).resolves.toBeUndefined();
    expect(readStream.mock.calls).toEqual([[['Root Entry', classStream]]]);
  });

  it('reads scoped values using the same NameID for the parent and embedded message', async () => {
    const child = `${attachment}/${embedded}`;
    const { reader, readStream } = session({
      [classStream]: unicode('IPM.Appointment'),
      '__substg1.0_1000001F': unicode('Body stream'),
      [nameEntry]: Buffer.from('0d820000060000000e820000060001000882000006000200020000000800030015820000060004002382000006000500', 'hex'),
      [`${names}/__substg1.0_00020102`]: Buffer.from('0220060000000000c00000000000004690dad86e0b451b1098da00aa003f1305', 'hex'),
      [fixed]: fixedStream(32, [0x8000, 0x0040, fileTime(start) + 1n], [0x0060, 0x0040, fileTime(end)],
        [0x8001, 0x0040, 0n], [0x0061, 0x0040, fileTime(end)], [0x8004, 0x000b, 1n], [0x8005, 0x000b, 0n]),
      '__substg1.0_8002001F': unicode('  Office  '),
      '__substg1.0_8003001F': unicode('Ignored fallback'),
      [`${attachment}/${fixed}`]: fixedStream(8, [0x3705, 0x0003, 5n]),
      [`${child}/${classStream}`]: unicode('IPM.Schedule.Meeting.Request'),
      [`${child}/${fixed}`]: fixedStream(24, [0x8000, 0x0007, 0n], [0x0060, 0x0040, fileTime(end)],
        [0x8001, 0x0040, 0xffffffffffffffffn], [0x8004, 0x0003, 1n], [0x8005, 0x000b, 1n]),
      [`${child}/__substg1.0_8002001F`]: unicode('  '),
      [`${child}/__substg1.0_8003001E`]: Buffer.from(' Remote \0'),
    });
    await expect(reader.getCalendar()).resolves.toEqual({
      messageClass: 'IPM.Appointment', startAt: start, endAt: end, location: 'Office',
      allDay: true, isRecurringSeries: false,
    });
    expect(readStream.mock.calls.every(([path]) =>
      [classStream, fixed, '__substg1.0_8002001F', names].includes(path[1]))).toBe(true);
    const nested = await reader.getEmbeddedMessage(0);
    expect(nested.calendar).toEqual({
      messageClass: 'IPM.Schedule.Meeting.Request', startAt: end, location: 'Remote', isRecurringSeries: true,
    });
    expect(readStream.mock.calls.filter(([[, ...path]]) => path.join('/') === nameEntry)).toHaveLength(1);
  });

  it('recovers normal dates with one diagnostic when NameID entries are malformed', async () => {
    const { reader } = session({
      [classStream]: unicode('IPM.Appointment'),
      [nameEntry]: Buffer.alloc(7),
      [fixed]: fixedStream(32, [0x0060, 0x0040, fileTime(start)], [0x0061, 0x0040, fileTime(end)]),
    });
    const calendar = { messageClass: 'IPM.Appointment', startAt: start, endAt: end };
    await expect(reader.getCalendar()).resolves.toEqual(calendar);
    expect(reader.getDiagnostics()).toEqual([expect.objectContaining({ code: 'CALENDAR_DECODE_FAILED' })]);
    await expect(reader.parse()).resolves.toMatchObject({ calendar, diagnostics: reader.getDiagnostics() });
  });

  it.each([new InvalidCfbfError('Bad sector'), new MsgError('I/O failure'), new RangeError('maxInputBytes')])(
    'propagates %s while reading NameID', async (error) => {
      const { reader } = session({ [classStream]: unicode('IPM.Appointment') }, error);
      await expect(reader.getCalendar()).rejects.toBe(error);
      expect(reader.getDiagnostics()).toEqual([]);
    },
  );

  it('propagates cancellation even if the calendar data was already read', async () => {
    const { reader } = session({ [classStream]: unicode('IPM.Appointment') });
    const controller = new AbortController();
    reader.configure({ signal: controller.signal });
    await reader.getCalendar();
    const reason = new Error('Read cancelled');
    controller.abort(reason);
    await expect(reader.getCalendar()).rejects.toBe(reason);
    expect(reader.getDiagnostics()).toEqual([]);
  });
});
