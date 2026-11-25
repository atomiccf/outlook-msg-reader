import path from 'node:path';
import { createJiti } from 'jiti';

const mode = process.argv[2] ?? 'heap-bomb';

if (mode === 'heap-bomb') {
  const chunks = [];
  while (true) chunks.push(new Array(1e5).fill('x'));
}

if (mode === 'parse') {
  const jiti = createJiti(import.meta.url);
  const { parseMsg } = await jiti.import('../../../src/index.ts');
  const fixture = path.resolve(import.meta.dirname, '../../fixtures/valid/outlook/rtf-unicode.msg');
  await parseMsg(fixture, {
    maxInputBytes: 8 * 1024 * 1024,
    maxResultBytes: 8 * 1024 * 1024,
    maxRtfBytes: 1024 * 1024,
  });
  process.exit(0);
}

throw new Error(`unknown oomWorker mode: ${mode}`);
