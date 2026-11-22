import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { bundle } from './build.mjs';

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
