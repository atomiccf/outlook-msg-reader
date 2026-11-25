import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/logging/Logger';
import type { PropertyStore } from '../../src/mapi/PropertyStore';
import type { CodePageReader } from '../../src/mapi/CodePageReader';
import { BodyReader } from '../../src/msg/BodyReader';
import { Decoder } from '../../src/encoding/decoder';

const createHtmlReader = (html: string): BodyReader => {
  const properties = {
    readString: async () => undefined,
    read: async (ids: string[]) => (ids[0] === '1013' ? Buffer.from(html) : undefined),
  } as unknown as PropertyStore;
  const logger = { warn: vi.fn() } as unknown as Logger;
  const codePageReader = { getCodepage: async () => 1252 } as unknown as CodePageReader;
  return new BodyReader(properties, logger, new Decoder(), codePageReader);
};

describe('html body budget', { timeout: 10_000 }, () => {
  it('converts 100000 nested divs to text in under 2s', async () => {
    const html = `${'<div>'.repeat(100_000)}leaf${'</div>'.repeat(100_000)}`;
    const start = performance.now();
    const body = await createHtmlReader(html).read();
    expect(performance.now() - start).toBeLessThan(2000);
    expect(typeof body.text).toBe('string');
  });

  it('decodes a 1 MiB numeric-entity payload in under 2s', async () => {
    const unit = '&#99999999999;&#x10FFFF;';
    const html = unit.repeat(Math.ceil((1024 * 1024) / unit.length));
    const start = performance.now();
    const body = await createHtmlReader(html).read();
    expect(performance.now() - start).toBeLessThan(2000);
    expect(typeof body.text).toBe('string');
  });

  it('handles 50000 br tags linearly in under 1s', async () => {
    const html = `${'<br>'.repeat(50_000)}done`;
    const start = performance.now();
    const body = await createHtmlReader(html).read();
    expect(performance.now() - start).toBeLessThan(1000);
    expect(typeof body.text).toBe('string');
    expect(body.text).toContain('done');
  });

  it('finishes when script and style tags are unclosed or broken', async () => {
    const html = '<script>alert(1)<style>body{color:red}<div><p>ok';
    const start = performance.now();
    const body = await createHtmlReader(html).read();
    expect(performance.now() - start).toBeLessThan(2000);
    expect(typeof body.text).toBe('string');
  });
});
