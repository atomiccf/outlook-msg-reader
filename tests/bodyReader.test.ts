import { describe, expect, it } from 'vitest';
import { NoopLogger } from '../src/logging/Logger';
import type { PropertyStore } from '../src/mapi/PropertyStore';
import { BodyReader } from '../src/msg/BodyReader';

const createReader = (html: string): BodyReader => {
  const properties = {
    readString: async () => undefined,
    read: async (ids: string[]) => ids[0] === '1013' ? Buffer.from(html) : undefined,
  } as unknown as PropertyStore;
  return new BodyReader(properties, new NoopLogger());
};

describe('BodyReader HTML fallback', () => {
  it('extracts readable text when a message only has an HTML body', async () => {
    const body = await createReader('<html><head><style>p{color:red}</style></head><body><p>Test &amp; message</p></body></html>').read();

    expect(body.html).toContain('<p>Test &amp; message</p>');
    expect(body.text).toBe('Test & message');
  });

  it('keeps an ASCII PR_BODY_HTML value as text instead of treating it as UTF-16', async () => {
    const body = await createReader('This is a message').read();

    expect(body.html).toBe('This is a message');
    expect(body.text).toBe('This is a message');
  });
});
