import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const corpus = path.join(import.meta.dirname, 'corpus');
const outlook = path.join(root, 'tests', 'fixtures', 'valid', 'outlook');
const sent2 = path.join(root, 'tests', 'fixtures', 'sent2.msg');

mkdirSync(path.join(import.meta.dirname, 'artifacts'), { recursive: true });
mkdirSync(corpus, { recursive: true });

for (const file of readdirSync(outlook)) {
  if (!file.toLowerCase().endsWith('.msg')) continue;
  copyFileSync(path.join(outlook, file), path.join(corpus, file));
}

if (existsSync(sent2)) {
  copyFileSync(sent2, path.join(corpus, 'sent2.msg'));
}

console.log(`seeded ${readdirSync(corpus).length} files into ${corpus}`);
