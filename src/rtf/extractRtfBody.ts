import { TextDecoder } from 'node:util';
import { PropertyDecodeError } from '../errors/errors';

type RtfState = {
  skip: boolean;
  htmlTag: boolean;
  htmlRtf: boolean;
  fontTable: boolean;
  font: number;
  unicodeFallbackLength: number;
  hidden: boolean;
  ignorable: boolean;
  unicodeAlternative?: number;
  unicodeDestination?: boolean;
};

const destinations = new Set([
  'colortbl', 'stylesheet', 'info', 'pict', 'object', 'objdata', 'filetbl',
  'listtable', 'listoverridetable', 'revtbl', 'rsidtbl', 'generator',
  'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf',
  'footnote', 'annotation', 'fldinst', 'datafield',
]);
const charsets: Record<number, number> = {
  0: 1252, 77: 10000, 128: 932, 129: 949, 130: 1361, 134: 936, 136: 950,
  161: 1253, 162: 1254, 163: 1258, 177: 1255, 178: 1256,
  186: 1257, 204: 1251, 222: 874, 238: 1250,
};
const characters = new Map(Object.entries({
  par: '\r\n', line: '\r\n', page: '\r\n', sect: '\r\n', tab: '\t', cell: '\t', row: '\r\n',
  emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’',
  ldblquote: '“', rdblquote: '”', emspace: '\u2003', enspace: '\u2002',
  qmspace: '\u2005', '~': '\u00a0', '_': '\u2011',
}));

const encodingLabels: Record<number, string> = {
  65001: 'utf-8', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5',
  10000: 'macintosh', 28592: 'iso-8859-2', 20866: 'koi8-r', 20127: 'us-ascii',
};
const BUFFER_SIZE = 4096;
const isLetter = (code: number): boolean => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isDigit = (code: number): boolean => code >= 48 && code <= 57;
const hexValue = (code: number): number => {
  if (isDigit(code)) return code - 48;
  const lower = code | 32;
  return lower >= 97 && lower <= 102 ? lower - 87 : -1;
};
const escapeHtml = (value: string, attribute = false): string => value.replace(
  attribute ? /[&<>"]/g : /[&<>]/g,
  char => char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&quot;',
);

interface ExtractionOptions {
  html?: boolean;
  text?: boolean;
  maxBytes?: number;
}

interface ExtractedBody {
  html?: string;
  text?: string;
}

/** Accumulates chunks and enforces the UTF-8 payload budget across surrogate pairs. */
class RtfOutput {
  private readonly parts: string[] = [];
  private pending = '';
  private size = 0;
  private highSurrogate = false;

  constructor(private readonly maxBytes?: number) {}

  append(value: string): void {
    if (!value) return;
    if (this.maxBytes !== undefined) this.charge(value, this.maxBytes);
    this.pending += value;
    if (this.pending.length >= BUFFER_SIZE) {
      this.parts.push(this.pending);
      this.pending = '';
    }
  }

  finish(): string {
    if (!this.parts.length) return this.pending;
    this.parts.push(this.pending);
    return this.parts.join('');
  }

  private charge(value: string, maxBytes: number): void {
    this.size += Buffer.byteLength(value);
    const first = value.charCodeAt(0);
    if (this.highSurrogate && first >= 0xdc00 && first <= 0xdfff) this.size -= 2;
    const last = value.charCodeAt(value.length - 1);
    this.highSurrogate = last >= 0xd800 && last <= 0xdbff;
    if (this.size > maxBytes) {
      throw new RangeError(`RTF conversion exceeds remaining maxResultBytes (${maxBytes})`);
    }
  }
}

/** One iterative parse session. Group state is scoped; font definitions belong to the document. */
class RtfBodyExtractor {
  private readonly stack: RtfState[] = [];
  private state: RtfState = {
    skip: false, htmlTag: false, htmlRtf: false, fontTable: false,
    font: 0, unicodeFallbackLength: 1, hidden: false, ignorable: false,
  };
  private readonly fonts = new Map<number, number>();
  private readonly explicitFontPages = new Set<number>();
  private readonly decoders = new Map<number, TextDecoder>();
  private readonly output: RtfOutput;
  private index = 0;
  private codePage = 1252;
  private defaultFont = 0;
  private isHtml = false;
  private documentClosed = false;
  private fallbackRemaining = 0;
  private bytes?: Uint8Array;
  private byteLength = 0;
  private activeDecoder?: TextDecoder;

  constructor(private readonly rtf: string, private readonly options: ExtractionOptions) {
    this.output = new RtfOutput(options.maxBytes);
  }

  extract(): ExtractedBody {
    while (this.index < this.rtf.length) {
      const code = this.rtf.charCodeAt(this.index++);
      if (this.documentClosed) this.readTrailingCharacter(code);
      else if (code === 123) this.openGroup();
      else if (code === 125) this.closeGroup();
      else if (code === 92) this.readEscape();
      else if (code !== 13 && code !== 10) this.readTextRun();
    }
    if (this.stack.length || !this.documentClosed) throw new PropertyDecodeError('Unbalanced RTF group');
    const content = this.output.finish();
    if (this.isHtml) return this.options.html === false ? {} : { html: content };
    return this.options.text === false ? {} : { text: content };
  }

  private readTrailingCharacter(code: number): void {
    if (code !== 0 && code !== 9 && code !== 10 && code !== 13 && code !== 32) {
      throw new PropertyDecodeError('Content after RTF document');
    }
  }

  private openGroup(): void {
    this.flushBytes();
    this.fallbackRemaining = 0;
    const alternative = this.state.unicodeAlternative;
    if (alternative !== undefined) this.state.unicodeAlternative = alternative + 1;
    this.stack.push(this.state);
    this.state = {
      ...this.state, ignorable: false, unicodeAlternative: undefined,
      unicodeDestination: alternative === 1,
    };
    if (alternative === 0) this.state.skip = true;
  }

  private closeGroup(): void {
    this.flushBytes();
    this.fallbackRemaining = 0;
    const parent = this.stack.pop();
    if (!parent) throw new PropertyDecodeError('Unbalanced RTF group');
    this.state = parent;
    this.documentClosed = this.stack.length === 0;
  }

  private readTextRun(): void {
    const start = this.index - 1;
    while (this.index < this.rtf.length) {
      const next = this.rtf.charCodeAt(this.index);
      if (next === 123 || next === 125 || next === 92 || next === 13 || next === 10) break;
      this.index += 1;
    }
    if (this.fallbackRemaining || this.isVisible()) this.emitLiteral(this.rtf.slice(start, this.index), true);
  }

  private readEscape(): void {
    if (this.index >= this.rtf.length) throw new PropertyDecodeError('Truncated RTF escape');
    const symbol = this.rtf.charCodeAt(this.index++);
    if (symbol === 39) this.readHexByte();
    else if (!isLetter(symbol)) this.readControlSymbol(symbol);
    else {
      this.flushBytes();
      this.readControlWord();
    }
  }

  private readHexByte(): void {
    const high = hexValue(this.rtf.charCodeAt(this.index));
    const low = hexValue(this.rtf.charCodeAt(this.index + 1));
    if (high < 0 || low < 0) throw new PropertyDecodeError('Invalid RTF hex escape');
    this.index += 2;
    if (!this.skipFallback() && this.isVisible()) this.writeByte((high << 4) | low);
  }

  private readControlSymbol(symbol: number): void {
    if (this.skipFallback()) return;
    if (symbol === 92 || symbol === 123 || symbol === 125) {
      // Escaped punctuation may be the trail byte of a DBCS character.
      if (this.isVisible()) this.writeByte(symbol);
      return;
    }
    this.flushBytes();
    if (symbol === 42) this.state.ignorable = true;
    else if (symbol === 10 || symbol === 13) this.emitLiteral('\r\n');
    else if (symbol === 95 && this.isHtml && this.state.htmlTag) this.emitLiteral('\u00ad');
    else this.emitLiteral(characters.get(String.fromCharCode(symbol)) ?? '');
  }

  private readControlWord(): void {
    const start = this.index - 1;
    while (isLetter(this.rtf.charCodeAt(this.index))) this.index += 1;
    const word = this.rtf.slice(start, this.index).toLowerCase();
    const numberStart = this.index;
    if (this.rtf.charCodeAt(this.index) === 45) this.index += 1;
    while (isDigit(this.rtf.charCodeAt(this.index))) this.index += 1;
    const parameter = this.index > numberStart ? Number(this.rtf.slice(numberStart, this.index)) : undefined;
    if (parameter !== undefined && !Number.isSafeInteger(parameter)) {
      throw new PropertyDecodeError('Invalid RTF control parameter');
    }
    if (this.rtf.charCodeAt(this.index) === 32) this.index += 1;
    this.handleControlWord(word, parameter);
  }

  private handleControlWord(word: string, parameter?: number): void {
    // Ignored destinations have no semantic effects; their binary payload is still consumed.
    if (this.state.ignorable && this.fallbackRemaining === 0) {
      const recognized = (word === 'htmltag' && this.isHtml)
        || (word === 'ud' && this.state.unicodeDestination);
      if (!recognized) this.state.skip = true;
      this.state.ignorable = false;
    }
    if (word === 'bin') {
      this.skipBinary(parameter);
      return;
    }
    if (this.skipFallback() || this.state.skip) return;
    if (word === 'fonttbl' && !this.state.htmlTag) {
      this.state.fontTable = true;
      return;
    }
    if (this.state.fontTable) {
      this.handleFontControl(word, parameter);
      return;
    }
    if (word === 'uc' && parameter !== undefined) {
      if (parameter < 0) throw new PropertyDecodeError('Invalid RTF Unicode fallback count');
      this.state.unicodeFallbackLength = parameter;
    } else if (word === 'u' && parameter !== undefined) this.emitUnicode(parameter);
    else {
      const character = characters.get(word);
      if (character !== undefined) this.emit(character);
      // MS-OXRTFEX: only textual escapes and Unicode controls affect HTMLTAG content.
      else if (!this.state.htmlTag) this.handleFormattingControl(word, parameter);
    }
  }

  private skipBinary(length?: number): void {
    if (length === undefined || length < 0 || length > this.rtf.length - this.index) {
      throw new PropertyDecodeError('Truncated RTF binary data');
    }
    this.index += length;
    this.skipFallback();
  }

  private skipFallback(): boolean {
    if (this.fallbackRemaining === 0) return false;
    this.fallbackRemaining -= 1;
    return true;
  }

  private handleFontControl(word: string, parameter?: number): void {
    if (parameter === undefined) return;
    switch (word) {
      case 'f':
        this.state.font = parameter;
        break;
      case 'fcharset':
        if (this.explicitFontPages.has(this.state.font)) return;
        if (parameter === 1) this.fonts.delete(this.state.font); // DEFAULT_CHARSET
        else this.fonts.set(this.state.font, charsets[parameter] ?? -parameter);
        break;
      case 'cpg':
        if (parameter <= 0) return;
        this.fonts.set(this.state.font, parameter);
        this.explicitFontPages.add(this.state.font);
        break;
    }
  }

  private emitUnicode(parameter: number): void {
    if (parameter < -32768 || parameter > 65535) throw new PropertyDecodeError('Invalid RTF Unicode character');
    const unicode = String.fromCharCode(parameter & 0xffff);
    if (this.isHtml) this.append(escapeHtml(unicode, true));
    else this.emit(unicode);
    this.fallbackRemaining = this.state.unicodeFallbackLength;
  }

  private handleFormattingControl(word: string, parameter?: number): void {
    const root = this.stack.length === 1;
    switch (word) {
      case 'fromhtml':
        if (root) this.isHtml = parameter === 1;
        break;
      case 'ansicpg':
        if (root && parameter !== undefined) this.codePage = parameter;
        break;
      case 'mac':
        if (root) this.codePage = 10000;
        break;
      case 'pc':
        if (root) this.codePage = 437;
        break;
      case 'pca':
        if (root) this.codePage = 850;
        break;
      case 'deff':
        if (root && parameter !== undefined) {
          this.defaultFont = parameter;
          this.state.font = parameter;
        }
        break;
      case 'upr':
        this.state.unicodeAlternative = 0;
        break;
      case 'f':
        if (parameter !== undefined) this.state.font = parameter;
        break;
      case 'plain':
        this.state.font = this.defaultFont;
        this.state.hidden = false;
        break;
      case 'htmltag':
        this.state.htmlTag = true;
        if (!this.isHtml) this.state.skip = true;
        break;
      case 'htmlrtf':
        this.state.htmlRtf = parameter !== 0;
        break;
      case 'v':
        this.state.hidden = parameter !== 0;
        break;
      default:
        if (word === 'mhtmltag' || destinations.has(word)
          || (this.isHtml && (word === 'pntext' || word === 'listtext'))) this.state.skip = true;
    }
  }

  private isVisible(): boolean {
    return !this.state.skip && !this.state.fontTable && !this.state.hidden
      && (!this.isHtml || !this.state.htmlRtf)
      && (this.isHtml ? this.options.html !== false : this.options.text !== false);
  }

  private append(value: string): void {
    if (value && this.isVisible()) this.output.append(value);
  }

  private emit(value: string): void {
    this.append(this.isHtml && !this.state.htmlTag ? escapeHtml(value) : value);
  }

  private emitLiteral(value: string, sourceBytes = false): void {
    if (this.fallbackRemaining > 0) {
      const skipped = Math.min(this.fallbackRemaining, value.length);
      this.fallbackRemaining -= skipped;
      value = value.slice(skipped);
    }
    if (!value || !this.isVisible()) return;
    if ((sourceBytes && /[\x80-\xff]/.test(value))
      || (this.activeDecoder && /^[\x00-\x7f]+$/.test(value))) {
      for (let index = 0; index < value.length; index += 1) this.writeByte(value.charCodeAt(index));
    } else {
      this.flushBytes();
      this.currentPage(); // ASCII literals still depend on a supported font charset.
      this.emit(value);
    }
  }

  private currentPage(): number {
    const page = this.state.htmlTag ? this.codePage : this.fonts.get(this.state.font) ?? this.codePage;
    if (page < 0) throw new PropertyDecodeError(`Unsupported RTF font charset: ${-page}`);
    return page;
  }

  private getDecoder(): TextDecoder {
    const page = this.currentPage();
    let decoder = this.decoders.get(page);
    if (!decoder) {
      try {
        decoder = new TextDecoder(encodingLabels[page] ?? `windows-${page}`, { fatal: true, ignoreBOM: true });
      } catch {
        throw new PropertyDecodeError(`Unsupported RTF code page: ${page}`);
      }
      this.decoders.set(page, decoder);
    }
    return decoder;
  }

  private writeByte(byte: number): void {
    this.activeDecoder ??= this.getDecoder();
    this.bytes ??= new Uint8Array(BUFFER_SIZE);
    if (this.byteLength === BUFFER_SIZE) this.flushBytes(false);
    this.bytes[this.byteLength++] = byte;
  }

  /** Retains partial multibyte characters between fixed-size chunks. */
  private flushBytes(final = true): void {
    if (!this.activeDecoder || !this.bytes) return;
    this.emit(this.activeDecoder.decode(this.bytes.subarray(0, this.byteLength), { stream: !final }));
    this.byteLength = 0;
    if (final) this.activeDecoder = undefined;
  }
}

/** Extracts HTML (MS-OXRTFEX) or text from a lossless Latin-1 RTF byte string. */
export function extractRtfBody(rtf: string, options: ExtractionOptions = {}): ExtractedBody {
  const { maxBytes } = options;
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) {
    throw new RangeError('maxBytes must be a non-negative safe integer');
  }
  if (!/^\{\\rtf1\b/.test(rtf)) throw new PropertyDecodeError('Invalid RTF document');
  return new RtfBodyExtractor(rtf, options).extract();
}
