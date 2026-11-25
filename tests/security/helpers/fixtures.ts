import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const FIXTURE_ROOT = path.resolve(import.meta.dirname, '../../fixtures');
const OUTLOOK_ROOT = path.join(FIXTURE_ROOT, 'valid', 'outlook');

interface Manifest {
  fixtures: Array<{ id: string; file: string }>;
}

export interface FixtureRef {
  id: string;
  file: string;
  absolutePath: string;
}

export function validFixtures(): FixtureRef[] {
  const manifest = JSON.parse(
    readFileSync(path.join(OUTLOOK_ROOT, 'manifest.json'), 'utf8'),
  ) as Manifest;
  const listed = manifest.fixtures.map((fixture) => ({
    id: fixture.id,
    file: fixture.file,
    absolutePath: path.join(OUTLOOK_ROOT, fixture.file),
  }));
  const sent2 = path.join(FIXTURE_ROOT, 'sent2.msg');
  if (existsSync(sent2)) {
    listed.push({ id: 'sent2', file: 'sent2.msg', absolutePath: sent2 });
  }
  return listed;
}

export function loadFixture(id: string): Buffer {
  const fixture = validFixtures().find((entry) => entry.id === id);
  if (!fixture) {
    throw new Error(`Unknown fixture id: ${id}`);
  }
  return readFileSync(fixture.absolutePath);
}
