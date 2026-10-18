import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { preProcessFile } from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { createMsgReader, InvalidCfbfError, parseMsg } from '../src';
import { createContainer } from '../src/di/container';
import { TOKENS } from '../src/di/tokens';

const sample = resolve(import.meta.dirname, 'fixtures/valid/outlook/plain-basic-unicode.msg');

describe('format layer boundaries', () => {
  it('keeps CFBF independent of MAPI and MSG modules', () => {
    const root = resolve(import.meta.dirname, '../src/cfb');
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter(file => file.endsWith('.ts'));
    for (const file of files) {
      const source = readFileSync(resolve(root, file), 'utf8');
      const imports = preProcessFile(source).importedFiles.map(reference => reference.fileName);
      expect(imports.filter(name => /(^|\/)(mapi|msg)(\/|$)/.test(name)), file).toEqual([]);
    }
  });
});

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

  it('supports Buffer input and parallel readers without console output', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const data = readFileSync(sample);
      const [first, second, parsed] = await Promise.all([
        createMsgReader(sample),
        createMsgReader(data),
        parseMsg(data),
      ]);

      try {
        expect(await first.getSubject()).toBe(await second.getSubject());
        await first.close();
        expect(await second.getSubject()).toBe(parsed.subject);
        expect(parsed).toHaveProperty('attachments');
        expect(log).not.toHaveBeenCalled();
        expect(info).not.toHaveBeenCalled();
      } finally {
        await Promise.all([first.close(), second.close()]);
      }
    } finally {
      log.mockRestore();
      info.mockRestore();
    }
  });
});
