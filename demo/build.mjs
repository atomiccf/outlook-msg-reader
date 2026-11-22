import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('.', import.meta.url));
const browserAdapters = {
  name: 'browser-adapters',
  setup(build) {
    const modules = {
      'node:fs': '',
      'node:os': 'export { unavailable as tmpdir };',
      'node:path': 'export { unavailable as join };',
      'node:stream': 'export const Readable = { from: unavailable };',
      'node:util': 'export const TextDecoder = globalThis.TextDecoder;',
      'node:buffer': `
        const utf8 = new TextDecoder('utf-8', { fatal: true });
        export function isUtf8(bytes) {
          try { utf8.decode(bytes); return true; } catch { return false; }
        }
      `,
    };
    build.onResolve({ filter: /^node:/ }, ({ path }) => (
      Object.hasOwn(modules, path) ? { path, namespace: 'demo-browser' } : undefined
    ));
    build.onLoad({ filter: /.*/, namespace: 'demo-browser' }, ({ path }) => ({
      contents: `function unavailable() { throw new Error('This demo only supports in-memory MSG files.'); }
        ${modules[path]}`,
    }));
  },
};

export function bundle(entryPoint, options = {}) {
  return build({
    absWorkingDir: directory,
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'esm',
    inject: ['./buffer.mjs'],
    plugins: [browserAdapters],
    ...options,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = new URL('./dist/', import.meta.url);
  await mkdir(output, { recursive: true });
  await bundle('public/app.js', { outfile: 'dist/app.js', minify: true, legalComments: 'eof' });
  for (const asset of ['index.html', 'styles.css']) {
    await copyFile(new URL(`./public/${asset}`, import.meta.url), new URL(asset, output));
  }
}
