import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createMsgReader, InvalidCfbfError, parseMsg } from '../src';
import { createContainer } from '../src/di/container';
import { TOKENS } from '../src/di/tokens';

const sample = 'sample/sample.msg';
const sampleIt = existsSync(sample) ? it : it.skip;

describe('dependency lifetimes', () => {
  it('shares stateless services and isolates file state between scopes', () => {
    const root = createContainer();
    const first = root.createScope();
    const second = root.createScope();

    expect(first.get(TOKENS.decoder)).toBe(second.get(TOKENS.decoder));
    expect(first.get(TOKENS.cfbReader)).not.toBe(second.get(TOKENS.cfbReader));
    expect(first.get(TOKENS.fatReader)).not.toBe(second.get(TOKENS.fatReader));
    expect(first.get(TOKENS.directoryReader)).not.toBe(second.get(TOKENS.directoryReader));
  });
});

describe('isolated message sessions', () => {
  it('reports invalid compound files through the public error model', async () => {
    await expect(parseMsg(Buffer.alloc(512))).rejects.toBeInstanceOf(InvalidCfbfError);
  });

  sampleIt('supports Buffer input and parallel readers without console output', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const data = readFileSync(sample);
      const [first, second, parsed] = await Promise.all([
        createMsgReader(sample),
        createMsgReader(data),
        parseMsg(data),
      ]);

      expect(first.getCFBReader()).not.toBe(second.getCFBReader());
      expect(await first.getSubject()).toBe(await second.getSubject());
      expect(parsed).toHaveProperty('attachments');
      expect(log).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      info.mockRestore();
    }
  });
});
