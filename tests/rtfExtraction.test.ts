import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMsgReader, parseMsg } from '../src';
import { extractRtfBody } from '../src/rtf/extractRtfBody';
import { BodyReader } from '../src/msg/BodyReader';
import { Decoder } from '../src/encoding/decoder';
import type { PropertyStore } from '../src/mapi/PropertyStore';
import type { CodePageReader } from '../src/mapi/CodePageReader';
import type { Logger } from '../src/logging/Logger';

const encapsulated = String.raw`{\rtf1\ansi\ansicpg936\fromhtml1
{\fonttbl{\f0\fcharset134 Simsun;}{\f1\fcharset0 Arial;}}
{\colortbl;\red255\green0\blue0;}
{\*\htmltag <html><head><style>p\{color:red\}</style></head><body><p>}
\f0 \'d6\'d0\'ce\'c4{\*\htmltag &nbsp;}\htmlrtf \'a0\htmlrtf0
{\*\htmltag <b>}\htmlrtf {\b\htmlrtf0 Hello}\htmlrtf0{\*\htmltag </b></p></body></html>}}`;
const extractedHtml = '<html><head><style>p{color:red}</style></head><body><p>中文&nbsp;<b>Hello</b></p></body></html>';

function createReader(rtf: string | Buffer, text?: string, html?: string): BodyReader {
  const payload = Buffer.isBuffer(rtf) ? rtf : Buffer.from(rtf);
  const compressed = Buffer.alloc(payload.length + 16);
  compressed.writeUInt32LE(compressed.length - 4, 0);
  compressed.writeUInt32LE(payload.length, 4);
  compressed.writeUInt32LE(0x414c454d, 8);
  payload.copy(compressed, 16);
  const properties = {
    readString: async (ids: string[]) => ids[0] === '1000' ? text : undefined,
    read: async (ids: string[]) => ids[0] === '1009' ? compressed : html,
  } as unknown as PropertyStore;
  return new BodyReader(properties, { warn: vi.fn() } as unknown as Logger,
    new Decoder(), { getCodepage: async () => 1252 } as unknown as CodePageReader);
}

describe('RTF body extraction', () => {
  it('recovers Chinese HTML, shared visible text, and nested htmlrtf states', () => {
    expect(extractRtfBody(encapsulated)).toEqual({ html: extractedHtml });
  });

  it('ignores source newlines, destinations, rewritten URLs and RTF-only content', () => {
    const rtf = String.raw`{\rtf1\fromhtml1
{\*\generator Word}{\*\mhtmltag <img src="rewritten">}{\*\htmltag <p>}
one\htmlrtf {hidden\htmlrtf0 two}hidden\htmlrtf0 three{\*\htmltag </p>}}`;
    expect(extractRtfBody(rtf)).toEqual({ html: '<p>onetwothree</p>' });
  });

  it('keeps ignored parent destinations suppressed even around htmltag groups', () => {
    expect(extractRtfBody(String.raw`{\rtf1\fromhtml1{\*\unknown {\*\htmltag secret}}{\*\htmltag <p>ok</p>}}`))
      .toEqual({ html: '<p>ok</p>' });
  });

  it('extracts readable text from ordinary RTF with tables and field results', () => {
    const rtf = String.raw`{\rtf1{\fonttbl{\f0 Arial;}}{\info{\title Metadata}}
Hello {\b world}\par {\field{\*\fldinst HYPERLINK "hidden"}{\fldrslt Link}}
\line A\cell B\row {\v hidden}visible\tab \{\}\\}`;
    expect(extractRtfBody(rtf)).toEqual({ text: 'Hello world\r\nLink\r\nA\tB\r\nvisible\t{}\\' });
  });

  it('decodes font-specific Windows code pages and restores the previous font', () => {
    const rtf = String.raw`{\rtf1\ansi\ansicpg1252\deff0
{\fonttbl{\f0\fcharset0 Arial;}{\f1\fcharset204 Arial;}}
\'e9 {\f1\'cf\'f0\'e8\'e2\'e5\'f2} \'e9}`;
    expect(extractRtfBody(rtf)).toEqual({ text: 'é Привет é' });
  });

  it('uses the document code page inside HTML tags and the font for shared text', () => {
    const rtf = String.raw`{\rtf1\ansicpg936\fromhtml1{\fonttbl{\f0\fcharset204 Arial;}}
\f0{\*\htmltag <p title="\'d6\'d0\'ce\'c4">}\'cf\'f0\'e8\'e2\'e5\'f2{\*\htmltag </p>}}`;
    expect(extractRtfBody(rtf)).toEqual({ html: '<p title="中文">Привет</p>' });
  });

  it('supports explicit font code pages and mixed escaped/literal multibyte sequences', () => {
    const rtf = String.raw`{\rtf1{\fonttbl{\f0\fcharset0\cpg936 Simsun;}}\f0\'81@}`;
    expect(extractRtfBody(rtf)).toEqual({ text: '丂' });
  });

  it('decodes literal bytes using the selected font, independently of the document code page', () => {
    const rtf = Buffer.concat([
      Buffer.from(String.raw`{\rtf1\ansicpg1252{\fonttbl{\f0\fcharset204;}{\f1\fcharset0;}}\f0 `),
      Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]),
      Buffer.from(String.raw` {\f1 `), Buffer.from([0xe9]), Buffer.from('}}'),
    ]);
    expect(extractRtfBody(rtf.toString('latin1'))).toEqual({ text: 'Привет é' });
  });

  it('combines raw bytes and hex escapes into a single UTF-8 text run', () => {
    const rtf = Buffer.concat([
      Buffer.from(String.raw`{\rtf1\ansicpg65001 `), Buffer.from([0xe4]),
      Buffer.from(String.raw`\'b8`), Buffer.from([0xad]), Buffer.from('}'),
    ]);
    expect(extractRtfBody(rtf.toString('latin1'))).toEqual({ text: '中' });
  });

  it('uses the document code page for raw HTMLTAG bytes and the font for raw shared text', () => {
    const rtf = Buffer.concat([
      Buffer.from(String.raw`{\rtf1\ansicpg936\fromhtml1{\fonttbl{\f0\fcharset204;}}{\*\htmltag <p title="`),
      Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), Buffer.from(String.raw`">}`),
      Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]), Buffer.from(String.raw`{\*\htmltag </p>}}`),
    ]);
    expect(extractRtfBody(rtf.toString('latin1'))).toEqual({ html: '<p title="中文">Привет</p>' });
  });

  it('retains raw multibyte sequences at buffer boundaries and enforces the UTF-8 output budget', () => {
    const rtf = Buffer.concat([
      Buffer.from(String.raw`{\rtf1\ansicpg936 ` + 'A'.repeat(4095)),
      Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), Buffer.from('}'),
    ]).toString('latin1');
    const text = 'A'.repeat(4095) + '中文';
    const maxBytes = Buffer.byteLength(text);
    expect(extractRtfBody(rtf, { maxBytes })).toEqual({ text });
    expect(() => extractRtfBody(rtf, { maxBytes: maxBytes - 1 })).toThrow(RangeError);
  });

  it('decodes Unicode, surrogate pairs, scoped uc counts and escaped fallback bytes', () => {
    const rtf = String.raw`{\rtf1\uc1\u20013?\u25991\'3f {\uc2\u1046ab}\u1041? \u-10179?\u-8704?}`;
    expect(extractRtfBody(rtf)).toEqual({ text: '中文 ЖБ 😀' });
  });

  it('prefers Unicode alternatives and skips their ANSI duplicates', () => {
    expect(extractRtfBody(String.raw`{\rtf1{\upr{ANSI}{\*\ud Unicode \u20013?}}}`))
      .toEqual({ text: 'Unicode 中' });
  });

  it('skips binary data without treating its braces as RTF groups', () => {
    expect(extractRtfBody(String.raw`{\rtf1 before{\pict\bin4 {}\x}after}`))
      .toEqual({ text: 'beforeafter' });
  });

  it('honors the output budget including Unicode surrogate pairs', () => {
    const rtf = String.raw`{\rtf1\u-10179?\u-8704?}`;
    expect(extractRtfBody(rtf, { maxBytes: 4 })).toEqual({ text: '😀' });
    expect(() => extractRtfBody(rtf, { maxBytes: 3 })).toThrow(RangeError);
    expect(extractRtfBody(rtf, { maxBytes: 0, text: false })).toEqual({});
  });

  it('ignores unknown control words that match Object prototype properties', () => {
    expect(extractRtfBody(String.raw`{\rtf1 before\constructor after}`)).toEqual({ text: 'beforeafter' });
  });

  it('does not let ignored destinations change the document encoding or selected font', () => {
    expect(extractRtfBody(String.raw`{\rtf1\ansicpg1252{\*\unknown\ansicpg936}\'e9}`))
      .toEqual({ text: 'é' });
  });

  it('decodes escaped RTF punctuation as the trailing byte of a multibyte character', () => {
    expect(extractRtfBody(String.raw`{\rtf1\ansicpg932\'81\\}`)).toEqual({ text: '―' });
  });

  it('ignores formatting controls inside HTMLTAG content', () => {
    expect(extractRtfBody(String.raw`{\rtf1\fromhtml1{\*\htmltag <p>\htmlrtf\fonttbl\v text</p>}}`))
      .toEqual({ html: '<p>text</p>' });
  });

  it('converts the HTMLTAG soft-hyphen escape independently of plain RTF', () => {
    expect(extractRtfBody(String.raw`{\rtf1\fromhtml1{\*\htmltag <p>a\_b</p>}}`))
      .toEqual({ html: '<p>a\u00adb</p>' });
    expect(extractRtfBody(String.raw`{\rtf1 a\_b}`)).toEqual({ text: 'a\u2011b' });
  });

  it('preserves a literal UTF-8 BOM within a text run', () => {
    expect(extractRtfBody(String.raw`{\rtf1\ansicpg65001\'ef\'bb\'bfText}`))
      .toEqual({ text: '\ufeffText' });
  });

  it('does not decode or allocate output for an unrequested body format', () => {
    expect(extractRtfBody(String.raw`{\rtf1\ansicpg999999\'ff}`, { text: false, maxBytes: 0 }))
      .toEqual({});
  });

  it('does not silently decode unsupported font charsets with an unrelated code page', () => {
    expect(() => extractRtfBody(String.raw`{\rtf1{\fonttbl{\f0\fcharset2 Symbol;}}\f0\'61}`))
      .toThrow('Unsupported RTF font charset: 2');
  });

  it.each([NaN, Infinity, -1, 1.5])('rejects invalid output budgets: %s', (maxBytes) => {
    expect(() => extractRtfBody(String.raw`{\rtf1 ok}`, { maxBytes })).toThrow(RangeError);
  });

  it('keeps multibyte decoder state across fixed-size byte-buffer boundaries', () => {
    const rtf = String.raw`{\rtf1\ansicpg936 ` + String.raw`\'41`.repeat(4095)
      + String.raw`\'d6\'d0\'ce\'c4}`;
    const text = 'A'.repeat(4095) + '中文';
    expect(extractRtfBody(rtf, { maxBytes: Buffer.byteLength(text) })).toEqual({ text });
  });

  it('does not buffer an entire escaped byte run before applying the output limit', () => {
    const rtf = String.raw`{\rtf1 ` + String.raw`\'e9`.repeat(5000) + String.raw`\'zz}`;
    expect(() => extractRtfBody(rtf, { maxBytes: 1 })).toThrow(RangeError);
  });

  it('keeps binary destinations ignorable even when bin is their first control word', () => {
    expect(extractRtfBody(String.raw`{\rtf1{\*\bin1 xhidden}visible}`)).toEqual({ text: 'visible' });
  });

  it('restores scoped Unicode fallback counts and stops fallback at group boundaries', () => {
    expect(extractRtfBody(String.raw`{\rtf1\uc2\u1046\'3f\~{\uc0\u1041}Z\u1042{x}Y}`))
      .toEqual({ text: 'ЖБZВxY' });
  });

  it('lets explicit font code pages override unsupported charset mappings', () => {
    expect(extractRtfBody(String.raw`{\rtf1{\fonttbl{\f0\cpg1251\fcharset2 Symbol;}}\'cf}`))
      .toEqual({ text: 'П' });
  });

  it('handles repeated font changes and Unicode pairs at output chunk boundaries', () => {
    const text = 'x'.repeat(4095) + '😀é';
    const rtf = String.raw`{\rtf1 ` + 'x'.repeat(4095) + String.raw`\u-10179?\u-8704?\'e9}`;
    expect(extractRtfBody(rtf, { maxBytes: Buffer.byteLength(text) })).toEqual({ text });
    expect(() => extractRtfBody(rtf, { maxBytes: Buffer.byteLength(text) - 1 })).toThrow(RangeError);
  });

  it('keeps visible list labels in plain RTF while suppressing RTF-only HTML labels', () => {
    expect(extractRtfBody(String.raw`{\rtf1{\listtext\u8226?\tab}First\par{\pntext 2.\tab}Second}`))
      .toEqual({ text: '•\tFirst\r\n2.\tSecond' });
    expect(extractRtfBody(String.raw`{\rtf1\fromhtml1{\*\htmltag <ul><li>}{\listtext\u8226?\tab}First{\*\htmltag </li></ul>}}`))
      .toEqual({ html: '<ul><li>First</li></ul>' });
  });

  it('preserves visible page and section boundaries', () => {
    expect(extractRtfBody(String.raw`{\rtf1 One\page Two\sect Three}`))
      .toEqual({ text: 'One\r\nTwo\r\nThree' });
  });

  it.each(['pc', 'pca'])('does not silently decode unsupported DOS encoding \\%s as Windows', (encoding) => {
    expect(() => extractRtfBody(`{\\rtf1\\${encoding}\\'82}`)).toThrow('Unsupported RTF code page:');
  });

  it.each([
    'not RTF', String.raw`{\rtf1 text`, String.raw`{\rtf1 text}}`,
    String.raw`{\rtf1 \'xx}`, String.raw`{\rtf1\bin100 data}`,
    String.raw`{\rtf1\uc-1 text}`, String.raw`{\rtf1\ansicpg999999 \'ff}`,
  ])('rejects malformed or unsupported conversion: %s', (rtf) => {
    expect(() => extractRtfBody(rtf)).toThrow();
  });
});

describe('BodyReader RTF fallback', () => {
  it('keeps binary lengths in bytes when the RTF document declares UTF-8', async () => {
    const rtf = Buffer.concat([
      Buffer.from(String.raw`{\rtf1\ansicpg65001 before{\pict\bin3 `),
      Buffer.from('中'), Buffer.from('}after}'),
    ]);
    const onDiagnostic = vi.fn();
    const body = await createReader(rtf).read(undefined, undefined, 0, onDiagnostic);
    expect(body.text).toBe('beforeafter');
    expect(Buffer.from(body.rtf!, 'latin1')).toEqual(rtf);
    expect(onDiagnostic).not.toHaveBeenCalled();
  });

  it('accounts for the lossless raw RTF string and derived text in one result budget', async () => {
    const rtf = Buffer.concat([Buffer.from(String.raw`{\rtf1\ansicpg65001 `), Buffer.from('中'), Buffer.from('}')]);
    const body = await createReader(rtf).read();
    const maxBytes = Buffer.byteLength(body.rtf!) + Buffer.byteLength('中');
    expect(body.text).toBe('中');
    expect(await createReader(rtf).read(undefined, maxBytes)).toEqual(body);
    await expect(createReader(rtf).read(undefined, maxBytes - 1)).rejects.toThrow(RangeError);
  });

  it('retains RTF and fills missing HTML and text', async () => {
    expect(await createReader(encapsulated).read()).toEqual({
      rtf: encapsulated, html: extractedHtml, text: '中文 Hello',
    });
  });

  it('preserves original MSG text while filling only missing HTML', async () => {
    expect(await createReader(encapsulated, 'Original text').read()).toEqual({
      rtf: encapsulated, html: extractedHtml, text: 'Original text',
    });
  });

  it('preserves original MSG HTML and derives text from it rather than RTF', async () => {
    expect(await createReader(encapsulated, undefined, '<p>Original HTML</p>').read()).toEqual({
      rtf: encapsulated, html: '<p>Original HTML</p>', text: 'Original HTML',
    });
  });

  it('does not replace an explicitly empty HTML body', async () => {
    expect(await createReader(encapsulated, 'Original', '').read()).toEqual({
      rtf: encapsulated, html: '', text: 'Original',
    });
  });

  it('extracts text without inventing HTML for ordinary RTF', async () => {
    const rtf = String.raw`{\rtf1\fromtext Hello\par world}`;
    expect(await createReader(rtf).read()).toEqual({ rtf, text: 'Hello\r\nworld' });
  });

  it('preserves RTF and other bodies and reports conversion errors separately', async () => {
    const rtf = String.raw`{\rtf1 unclosed`;
    const onDiagnostic = vi.fn();
    expect(await createReader(rtf, 'Available').read(undefined, undefined, 0, onDiagnostic))
      .toEqual({ rtf, text: 'Available' });
    expect(onDiagnostic).toHaveBeenCalledExactlyOnceWith({
      code: 'RTF_CONVERSION_FAILED', message: 'Unable to extract readable body from RTF',
    });
  });

  it('counts all returned formats in the result budget and propagates limit errors', async () => {
    const rtf = String.raw`{\rtf1\fromhtml1{\*\htmltag <p>Hello</p>}}`;
    const bytes = Buffer.byteLength(rtf + '<p>Hello</p>' + 'Hello');
    const onDiagnostic = vi.fn();
    expect(await createReader(rtf).read(undefined, bytes, 0, onDiagnostic)).toEqual({
      rtf, html: '<p>Hello</p>', text: 'Hello',
    });
    await expect(createReader(rtf).read(undefined, bytes - 1, 0, onDiagnostic)).rejects.toThrow(RangeError);
    await expect(createReader(rtf).read(undefined, Buffer.byteLength(rtf), 0, onDiagnostic)).rejects.toThrow(RangeError);
    expect(onDiagnostic).not.toHaveBeenCalled();
  });
});

describe('public RTF-only messages', () => {
  it.each([
    {
      name: 'font-specific literal bytes', text: 'Привет',
      rtf: Buffer.concat([Buffer.from(String.raw`{\rtf1{\fonttbl{\f0\fcharset204;}}`),
        Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]), Buffer.from('}')]),
    },
    {
      name: 'UTF-8 binary byte length', text: 'AB',
      rtf: Buffer.concat([Buffer.from(String.raw`{\rtf1\ansicpg65001 A{\pict\bin3 `),
        Buffer.from('中'), Buffer.from('}B}')]),
    },
  ])('parses $name without corruption or false diagnostics', async ({ rtf, text }) => {
    const input = readFileSync(resolve(import.meta.dirname, 'fixtures/valid/outlook/rtf-unicode.msg'));
    const header = input.indexOf(Buffer.from('LZFu')) - 8;
    expect(header).toBeGreaterThanOrEqual(0);
    expect(rtf.length + 16).toBeLessThanOrEqual(input.readUInt32LE(header) + 4);
    input.writeUInt32LE(rtf.length + 12, header);
    input.writeUInt32LE(rtf.length, header + 4);
    input.writeUInt32LE(0x414c454d, header + 8);
    rtf.copy(input, header + 16);
    const name = Buffer.from('__substg1.0_1000001F', 'utf16le');
    Buffer.from('__substg1.0_3000001F', 'utf16le').copy(input, input.indexOf(name));

    const message = await parseMsg(input);
    expect(message.body.text).toBe(text);
    expect(Buffer.from(message.body.rtf!, 'latin1')).toEqual(rtf);
    expect(message.diagnostics).toBeUndefined();
    const reader = await createMsgReader(input);
    try {
      expect(await reader.getBody()).toEqual(message.body);
      expect(reader.getDiagnostics()).toEqual([]);
    } finally {
      await reader.close();
    }
  });

  it('returns readable text through parseMsg and getBody when PR_BODY is absent', async () => {
    const input = readFileSync(resolve(import.meta.dirname, 'fixtures/valid/outlook/rtf-unicode.msg'));
    // Rename the native text directory entry in this in-memory copy only.
    const name = Buffer.from('__substg1.0_1000001F', 'utf16le');
    const offset = input.indexOf(name);
    expect(offset).toBeGreaterThanOrEqual(0);
    Buffer.from('__substg1.0_3000001F', 'utf16le').copy(input, offset);
    const parsed = await parseMsg(input);
    expect(parsed.body.text).toBe('RTF body generated by MsgKit.');
    expect(parsed.body.rtf).toContain('RTF body generated by MsgKit.');
    expect(parsed.body.html).toBeUndefined();
    expect(parsed.diagnostics).toBeUndefined();
    const reader = await createMsgReader(input);
    try {
      expect(await reader.getBody()).toEqual(parsed.body);
      expect(reader.getDiagnostics()).toEqual([]);
    } finally {
      await reader.close();
    }
  });
});
