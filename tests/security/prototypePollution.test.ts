import { describe, expect, it } from 'vitest';
import { parseMsg } from '../../src';
import { PROPERTY_IDS, PROPERTY_SET_GUIDS } from '../../src/constants/properties';
import type { CFBFReader } from '../../src/cfb/CFBReader';
import { DirectoryEntryType, type DirectoryNode } from '../../src/types';
import { NoopLogger } from '../../src/logging/Logger';
import { NamedPropertyReader } from '../../src/mapi/NamedPropertyReader';
import { PropertyStore } from '../../src/mapi/PropertyStore';
import type { PropertyReader } from '../../src/mapi/PropertyReader';
import { loadFixture, validFixtures } from './helpers/fixtures';

function protoKeys(): string[] {
  return Object.getOwnPropertyNames(Object.prototype).sort();
}

function node(name: string, type: DirectoryEntryType, children: DirectoryNode[] = []): DirectoryNode {
  return {
    sid: 0,
    name,
    type,
    startingSectorLocation: 0,
    streamSize: 0,
    children,
    parentSid: null,
  };
}

function stringNameStream(name: string): Buffer {
  const encoded = Buffer.from(name, 'utf16le');
  const stream = Buffer.alloc(4 + encoded.length);
  stream.writeUInt32LE(encoded.length, 0);
  encoded.copy(stream, 4);
  return stream;
}

describe('prototype pollution', () => {
  it('does not pollute Object.prototype when parsing valid fixtures', async () => {
    const before = protoKeys();
    for (const fixture of validFixtures()) {
      await parseMsg(loadFixture(fixture.id));
      expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    }
    expect(protoKeys()).toEqual(before);
  });

  it('stores dangerous named-property names as Map keys, not prototype fields', async () => {
    const names = ['__proto__', 'constructor', 'prototype'];
    const guidStream = Buffer.alloc(0);
    const chunks: Buffer[] = [];
    const entries = Buffer.alloc(8 * names.length);
    let stringOffset = 0;
    for (let i = 0; i < names.length; i += 1) {
      const chunk = stringNameStream(names[i]);
      chunks.push(chunk);
      entries.writeUInt32LE(stringOffset, i * 8);
      entries.writeUInt16LE((2 << 1) | 1, i * 8 + 4);
      entries.writeUInt16LE(i, i * 8 + 6);
      stringOffset += chunk.length;
    }
    const streams = new Map([
      ['__substg1.0_00020102', guidStream],
      ['__substg1.0_00030102', entries],
      ['__substg1.0_00040102', Buffer.concat(chunks)],
    ]);
    const cfbReader = {
      readStream: async (path: string[]) => streams.get(path[path.length - 1]) ?? null,
    } as unknown as CFBFReader;
    const reader = new NamedPropertyReader(cfbReader, new NoopLogger());
    await reader.initialize();
    for (const name of names) {
      expect(reader.getPropertyId(PROPERTY_SET_GUIDS.PS_PUBLIC_STRINGS, name)).toBeTypeOf('number');
    }
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it('indexes directory names without mutating Object.prototype', () => {
    const tree = node('Root Entry', DirectoryEntryType.Root, [
      node('__proto__', DirectoryEntryType.Storage),
      node('constructor', DirectoryEntryType.Storage),
      node('prototype', DirectoryEntryType.Stream),
    ]);
    const cfbReader = {
      getTree: () => tree,
    } as unknown as CFBFReader;
    const store = new PropertyStore(
      cfbReader,
      {} as PropertyReader,
      { initialize: async () => undefined, getPropertyId: () => undefined } as unknown as NamedPropertyReader,
    );
    expect(store.findStorages('__proto__')).toHaveLength(1);
    expect(store.findStorages('constructor')).toHaveLength(1);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    expect(Object.getOwnPropertyNames(Object.prototype).includes('polluted')).toBe(false);
  });

  it('does not mutate PROPERTY_IDS while parsing', async () => {
    const snapshot = { ...PROPERTY_IDS };
    await parseMsg(loadFixture(validFixtures()[0].id));
    expect(PROPERTY_IDS).toEqual(snapshot);
    expect(Object.keys(PROPERTY_IDS).sort()).toEqual(Object.keys(snapshot).sort());
  });
});
