import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/logging/Logger';
import type { PropertyStore } from '../src/mapi/PropertyStore';
import { BodyReader } from '../src/msg/BodyReader';
import { Decoder } from '../src/encoding/decoder';
import type { CodePageReader } from '../src/mapi/CodePageReader';

const createHtmlReader = (html: string | Buffer): BodyReader => {
  const properties = {
    readString: async () => undefined,
    read: async (ids: string[]) => ids[0] === '1013' ? Buffer.from(html) : undefined,
  } as unknown as PropertyStore;
  const logger = { warn: vi.fn() } as unknown as Logger;
  const codePageReader = { getCodepage: async () => 1252 } as unknown as CodePageReader;
  return new BodyReader(properties, logger, new Decoder(), codePageReader);
};

const COMPRESSED_MAGIC = 0x75465a4c;

function createRtfHeader(rawSize: number): Buffer {
  const input = Buffer.alloc(16);
  input.writeUInt32LE(12, 0);
  input.writeUInt32LE(rawSize, 4);
  input.writeUInt32LE(COMPRESSED_MAGIC, 8);
  return input;
}

describe('BodyReader', () => {
  it('stops before reading another body format when text exceeds the result budget', async () => {
    const read = vi.fn(async () => undefined);
    const properties = {
      readString: vi.fn(async () => 'Hello'),
      read,
    } as unknown as PropertyStore;
    const logger = { warn: vi.fn() } as unknown as Logger;
    const codePageReader = { getCodepage: vi.fn(async () => 1252) } as unknown as CodePageReader;

    await expect(new BodyReader(properties, logger, new Decoder(), codePageReader).read(undefined, 5, 1))
      .rejects.toThrow('MSG result exceeds maxResultBytes (5)');
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['1000', 'Hi'],
    ['8010', 'Y'],
  ])('keeps short text from property %s', async (propertyId, value) => {
    const properties = {
      readString: vi.fn(async (ids: string[]) => ids[0] === propertyId ? value : undefined),
      read: vi.fn(async () => undefined),
    } as unknown as PropertyStore;
    const logger = { warn: vi.fn() } as unknown as Logger;
    const codePageReader = { getCodepage: vi.fn(async () => 1252) } as unknown as CodePageReader;

    await expect(new BodyReader(properties, logger, new Decoder(), codePageReader).read())
      .resolves.toEqual({ text: value });
  });

  it('propagates the decompressed RTF size limit', async () => {
    const rtf = createRtfHeader(9);
    const properties = {
      readString: vi.fn(async () => null),
      read: vi.fn(async (ids: string[]) => ids[0] === '1009' ? rtf : null),
    } as unknown as PropertyStore;
    const logger = { warn: vi.fn() } as unknown as Logger;
    const codePageReader = { getCodepage: vi.fn(async () => 1252) } as unknown as CodePageReader;

    await expect(new BodyReader(properties, logger, new Decoder(), codePageReader).read(8))
      .rejects.toThrow('RTF body exceeds maxRtfBytes (8)');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('decodes binary HTML without a BOM using the message code page', async () => {
    const html = Buffer.concat([
      Buffer.from('<p>'),
      Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]),
      Buffer.from('</p>'),
    ]);
    const properties = {
      readString: vi.fn(async () => undefined),
      read: vi.fn(async (ids: string[]) => ids[0] === '1013' ? html : undefined),
    } as unknown as PropertyStore;
    const logger = { warn: vi.fn() } as unknown as Logger;
    const codePageReader = { getCodepage: vi.fn(async () => 1251) } as unknown as CodePageReader;

    await expect(new BodyReader(properties, logger, new Decoder(), codePageReader).read())
      .resolves.toEqual({ html: '<p>Привет</p>', text: 'Привет' });
    expect(codePageReader.getCodepage).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('replaces invalid numeric HTML entities without aborting body parsing', async () => {
    const properties = {
      readString: vi.fn(async () => undefined),
      read: vi.fn(async (ids: string[]) => ids[0] === '1013'
        ? '<p>before &#x110000; after &#xD800;</p>'
        : undefined),
    } as unknown as PropertyStore;
    const logger = { warn: vi.fn() } as unknown as Logger;
    const codePageReader = { getCodepage: vi.fn(async () => 1252) } as unknown as CodePageReader;

    await expect(new BodyReader(properties, logger, new Decoder(), codePageReader).read())
      .resolves.toEqual({
        html: '<p>before &#x110000; after &#xD800;</p>',
        text: 'before � after �',
      });
  });
});

describe('BodyReader HTML fallback', () => {
  it.each([
    ['<p>Hello<br />world</p><div>Next</div>', 'Hello\nworld\nNext'],
    ['before<script>x</script><STYLE>y</STYLE><head>z</head>after', 'beforeafter'],
    ['before<script>keep<style>hide</style>after', 'before keepafter'],
    ['before<>after <<tag> end <unfinished', 'before<>after end <unfinished'],
    ['&lt;p&gt;&#65;&#x1F600;&nbsp;&quot;&apos;', '<p>A😀 "\''],
  ])('preserves HTML fallback behavior for %s', async (html, text) => {
    expect(await createHtmlReader(html).read()).toEqual({ html, text });
  });

  it.each([
    ['unclosed angle brackets', '<'.repeat(256_000), '<'.repeat(256_000)],
    ['unclosed script sections', '<script>'.repeat(32_000), ''],
    ['unclosed script tags', '<script '.repeat(32_000), '<script '.repeat(32_000).trim()],
  ])('handles large input with %s', async (_name, html, text) => {
    expect(await createHtmlReader(html).read()).toEqual({ html, text });
  }, 2_000);

  it.each([4096, 4097])('decodes HTML with %i trailing padding bytes', async (paddingBytes) => {
    const html = '<html><body><p>Test email body.</p></body></html>';
    const bytes = Buffer.concat([Buffer.from(html), Buffer.alloc(paddingBytes)]);

    const body = await createHtmlReader(bytes).read();

    expect(body).toEqual({ html, text: 'Test email body.' });
  });

  it('preserves UTF-16LE HTML without a BOM when the stream has padding', async () => {
    const html = '<p>Привет, 世界</p>';
    const bytes = Buffer.concat([Buffer.from(html, 'utf16le'), Buffer.alloc(4096)]);

    expect(await createHtmlReader(bytes).read()).toEqual({ html, text: 'Привет, 世界' });
  });

  it('decodes an all-zero HTML stream as empty text', async () => {
    expect(await createHtmlReader(Buffer.alloc(4096)).read()).toEqual({ html: '' });
  });

  it('extracts readable text when a message only has an HTML body', async () => {
    const body = await createHtmlReader('<html><head><style>p{color:red}</style></head><body><p>Test &amp; message</p></body></html>').read();

    expect(body.html).toContain('<p>Test &amp; message</p>');
    expect(body.text).toBe('Test & message');
  });

  it('keeps an ASCII PR_BODY_HTML value as text instead of treating it as UTF-16', async () => {
    const body = await createHtmlReader('This is a message').read();

    expect(body.html).toBe('This is a message');
    expect(body.text).toBe('This is a message');
  });
});
