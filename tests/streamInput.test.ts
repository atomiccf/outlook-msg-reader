import { Readable } from 'node:stream';
import * as fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createMsgReader, parseMsg } from '../src';
import { createRandomAccessSource, DEFAULT_MAX_INPUT_BYTES } from '../src/cfb/InputSource';
import * as constants from '../src/constants/cfbf';


function createEmptyMsg(): Buffer {
  const sectorSize = 512;
  const input = Buffer.alloc(sectorSize * 3);

  Buffer.from(constants.CFBF_SIGNATURE).copy(input);
  input.writeUInt16LE(0x003e, 0x18);
  input.writeUInt16LE(3, 0x1a);
  input.writeUInt16LE(0xfffe, 0x1c);
  input.writeUInt16LE(9, 0x1e);
  input.writeUInt16LE(6, 0x20);
  input.writeUInt32LE(1, 0x2c);
  input.writeUInt32LE(1, 0x30);
  input.writeUInt32LE(0x1000, 0x38);
  input.writeUInt32LE(constants.END_OF_CHAIN, 0x3c);
  input.writeUInt32LE(0, 0x40);
  input.writeUInt32LE(constants.END_OF_CHAIN, 0x44);
  input.writeUInt32LE(0, 0x48);
  input.fill(0xff, 0x4c, sectorSize);
  input.writeUInt32LE(0, 0x4c);

  const fatOffset = sectorSize;
  input.fill(0xff, fatOffset, fatOffset + sectorSize);
  input.writeUInt32LE(constants.FAT_SECTOR, fatOffset);
  input.writeUInt32LE(constants.END_OF_CHAIN, fatOffset + 4);

  const directoryOffset = sectorSize * 2;
  const rootName = Buffer.from('Root Entry\0', 'utf16le');
  rootName.copy(input, directoryOffset);
  input.writeUInt16LE(rootName.length, directoryOffset + 0x40);
  input.writeUInt8(5, directoryOffset + 0x42);
  input.writeUInt8(1, directoryOffset + 0x43);
  input.writeInt32LE(-1, directoryOffset + 0x44);
  input.writeInt32LE(-1, directoryOffset + 0x48);
  input.writeInt32LE(-1, directoryOffset + 0x4c);
  input.writeUInt32LE(constants.END_OF_CHAIN, directoryOffset + 0x74);

  return input;
}

function chunk(input: Buffer, size: number): Buffer[] {
  const result: Buffer[] = [];
  for (let offset = 0; offset < input.length; offset += size) {
    result.push(input.subarray(offset, offset + size));
  }
  return result;
}

describe('Readable input', () => {
  it('aborts a pending iterator even if destroying its stream never settles next()', async () => {
    const controller = new AbortController();
    const stream = new Readable({ read() {} });
    let started!: () => void;
    const pending = new Promise<void>(resolve => { started = resolve; });
    stream[Symbol.asyncIterator] = () => ({
      next: () => { started(); return new Promise(() => undefined); },
    }) as ReturnType<Readable[typeof Symbol.asyncIterator]>;
    const result = parseMsg(stream, { signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await pending;
    controller.abort();
    await assertion;
    expect(stream.destroyed).toBe(true);
  });

  it('cleans a spilled file when cancellation interrupts finish()', async () => {
    const controller = new AbortController();
    const stream = new Readable({ read() {} });
    stream.push(Buffer.from('payload'));
    const mkdtemp = vi.fn(fs.promises.mkdtemp);
    const trackedFs = { ...fs, promises: { ...fs.promises, mkdtemp } } as unknown as typeof fs;
    const source = createRandomAccessSource(stream, trackedFs, {
      signal: controller.signal, streamMemoryThreshold: 0,
    });
    await source.read(0, 7);
    const directory = await mkdtemp.mock.results[0].value;
    const result = source.finish!();
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(stream.destroyed).toBe(true);
    await expect(fs.promises.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    await source.close();
  });

  it('waits for a pending spill before removing its temporary directory on abort', async () => {
    const controller = new AbortController();
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let directory!: string;
    const trackedFs = { ...fs, promises: { ...fs.promises,
      mkdtemp: async (prefix: string) => {
        directory = await fs.promises.mkdtemp(prefix);
        started();
        await gate;
        return directory;
      },
    } } as typeof fs;
    const stream = Readable.from([Buffer.from('payload')]);
    const source = createRandomAccessSource(stream, trackedFs, { signal: controller.signal, streamMemoryThreshold: 0 });
    const result = source.read(0, 7);
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await pending;
    controller.abort();
    release();
    await assertion;
    await expect(fs.promises.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('destroys already-aborted input without consuming it', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    const read = vi.fn();
    const stream = new Readable({ read });
    await expect(parseMsg(stream, { signal: controller.signal })).rejects.toBe(reason);
    expect(read).not.toHaveBeenCalled();
    expect(stream.destroyed).toBe(true);
    await expect(parseMsg(createEmptyMsg(), { signal: controller.signal })).rejects.toBe(reason);
  });

  it('reads only the requested prefix even when a size limit is configured', async () => {
    let release!: () => void;
    const trailing = new Promise<void>((resolve) => { release = resolve; });
    const stream = Readable.from((async function* () {
      yield Buffer.from('header');
      await trailing;
      yield Buffer.from('trailing');
    })());
    const source = createRandomAccessSource(stream, fs, { maxInputBytes: 32 });
    try {
      await expect(source.read(0, 6)).resolves.toEqual(Buffer.from('header'));
    } finally {
      release();
      await source.close();
    }
  });

  it('loads an MSG without waiting for unread trailing stream data', async () => {
    const input = createEmptyMsg();
    let release!: () => void;
    const trailing = new Promise<void>((resolve) => { release = resolve; });
    const stream = Readable.from((async function* () {
      yield input;
      await trailing;
      yield Buffer.alloc(1);
    })());
    try {
      const reader = await createMsgReader(stream, { maxInputBytes: input.length + 1 });
      await reader.close();
    } finally {
      release();
      stream.destroy();
    }
  });

  it('parses an MSG stream split into small chunks', async () => {
    const input = createEmptyMsg();
    const stream = Readable.from(chunk(Buffer.concat([input, Buffer.alloc(1024 * 1024)]), 7));

    const fromBuffer = await parseMsg(input);
    const fromStream = await parseMsg(stream);

    expect(fromStream).toEqual(fromBuffer);
    expect(stream.destroyed).toBe(true);
  });

  it('supports reads behind and ahead of the current stream position', async () => {
    const input = Buffer.from('0123456789abcdef');
    const source = createRandomAccessSource(
      Readable.from(chunk(input, 3)),
      {} as typeof fs,
    );

    expect((await source.read(8, 4)).toString()).toBe('89ab');
    expect((await source.read(1, 4)).toString()).toBe('1234');
    expect((await source.read(14, 8)).toString()).toBe('ef');
    await source.close();
  });

  it('packs many one-byte chunks into a bounded number of memory blocks', async () => {
    const count = 100_000;
    const source = createRandomAccessSource(
      Readable.from((function* () {
        for (let index = 0; index < count; index++) yield Buffer.from([index & 0xff]);
      })()),
      fs,
      { streamMemoryThreshold: count },
    );
    try {
      expect(await source.read(count - 3, 3)).toEqual(Buffer.from([
        (count - 3) & 0xff, (count - 2) & 0xff, (count - 1) & 0xff,
      ]));
      expect(await source.read(65_534, 4)).toEqual(Buffer.from([254, 255, 0, 1]));
      expect((source as unknown as { chunks: Buffer[] }).chunks).toHaveLength(2);
    } finally {
      await source.close();
    }
  });

  it('propagates errors from the input stream', async () => {
    const input = createEmptyMsg();
    const failure = new Error('stream failed');
    const stream = Readable.from((async function* () {
      yield input.subarray(0, 700);
      throw failure;
    })());

    await expect(parseMsg(stream)).rejects.toBe(failure);
    expect(stream.destroyed).toBe(true);
  });

  it('spills buffered stream data to disk after the memory threshold', async () => {
    const input = Buffer.from('0123456789abcdef');
    const source = createRandomAccessSource(Readable.from(chunk(input, 3)), fs, {
      streamMemoryThreshold: 4,
    });

    expect((await source.read(10, 4)).toString()).toBe('abcd');
    expect((await source.read(1, 4)).toString()).toBe('1234');
    await source.close();
  });

  it('rejects Readable input beyond the configured size limit', async () => {
    const source = createRandomAccessSource(Readable.from([Buffer.alloc(9)]), fs, {
      maxInputBytes: 8,
    });

    await expect(source.read(0, 9)).rejects.toThrow('exceeds maxInputBytes (8)');
    await source.close();
  });

  it('checks trailing Readable bytes even when parsing needs only the beginning', async () => {
    const input = createEmptyMsg();
    const stream = Readable.from([input, Buffer.alloc(1)]);

    await expect(parseMsg(stream, { maxInputBytes: input.length }))
      .rejects.toThrow(`Readable MSG input exceeds maxInputBytes (${input.length})`);
    expect(stream.destroyed).toBe(true);
  });

  it('accepts a Readable exactly at the configured size limit', async () => {
    const input = createEmptyMsg();

    await expect(parseMsg(Readable.from([input]), { maxInputBytes: input.length }))
      .resolves.toEqual(await parseMsg(input));
  });
});

describe('Buffer input', () => {
  it('releases its buffer on repeated close without changing caller-owned data', async () => {
    const input = Buffer.from('payload');
    const source = createRandomAccessSource(input, fs);
    const result = await source.read(0, input.length);
    expect(source).toHaveProperty('buffer', input);

    await source.close();
    await source.close();

    expect(source).toHaveProperty('buffer', undefined);
    expect(input.toString()).toBe('payload');
    expect(result.toString()).toBe('payload');
    await expect(source.read(0, 1)).rejects.toThrow('closed MSG input');
    await expect(source.read(0, 0)).rejects.toThrow('closed MSG input');
  });

  it('rejects input beyond the configured size limit before reading it', () => {
    expect(() => createRandomAccessSource(Buffer.alloc(9), fs, {
      maxInputBytes: 8,
    })).toThrow('Buffer MSG input exceeds maxInputBytes (8)');
  });
});

describe('File input', () => {
  it('applies the default input limit before opening a file', async () => {
    const stat = vi.fn(async () => ({ size: DEFAULT_MAX_INPUT_BYTES + 1 }));
    const open = vi.fn();
    const source = createRandomAccessSource(
      'message.msg',
      { promises: { stat, open } } as unknown as typeof fs,
    );

    await expect(source.read(0, 1))
      .rejects.toThrow(`File MSG input exceeds maxInputBytes (${DEFAULT_MAX_INPUT_BYTES})`);
    expect(open).not.toHaveBeenCalled();
    await source.close();
  });

  it('rejects a file beyond the configured size limit before reading it', async () => {
    const stat = vi.fn(async () => ({ size: 9 }));
    const source = createRandomAccessSource(
      'message.msg',
      { promises: { stat } } as unknown as typeof fs,
      { maxInputBytes: 8 },
    );

    await expect(source.read(0, 1)).rejects.toThrow('File MSG input exceeds maxInputBytes (8)');
    expect(stat).toHaveBeenCalledWith('message.msg');
    await source.close();
  });

  it('keeps one file handle open for the source lifetime', async () => {
    const input = Buffer.from('0123456789abcdef');
    const stat = vi.fn(async () => ({ size: input.length }));
    const close = vi.fn(async () => undefined);
    const read = vi.fn(async (
      target: Buffer,
      targetOffset: number,
      length: number,
      position: number,
    ) => {
      const bytesRead = input.copy(target, targetOffset, position, position + length);
      return { bytesRead, buffer: target };
    });
    const open = vi.fn(async () => ({ read, close }));
    const source = createRandomAccessSource(
      'message.msg',
      { promises: { open, stat } } as unknown as typeof fs,
    );

    expect((await source.read(0, 4)).toString()).toBe('0123');
    expect((await source.read(8, 4)).toString()).toBe('89ab');
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();

    await source.close();
    await source.close();
    expect(close).toHaveBeenCalledTimes(1);
    await expect(source.read(0, 1)).rejects.toThrow('closed MSG input');
  });
});
