import type { Logger } from '../logging/Logger';
import type { PropertyStore } from '../mapi/PropertyStore';
import type { MsgBody, MsgDiagnostic } from '../types';
import { decompressRtf } from '../rtf/decompressRtf';
import type { Decoder } from '../encoding/decoder';
import type { CodePageReader } from '../mapi/CodePageReader';
import { trimNullPadding } from '../utils/utils';

export class BodyReader {
  constructor(
    private readonly properties: PropertyStore,
    private readonly logger: Logger,
    private readonly decoder: Decoder,
    private readonly codePageReader: CodePageReader,
  ) {}

  async read(
    maxRtfBytes?: number,
    maxResultBytes?: number,
    existingResultBytes = 0,
    onDiagnostic?: (diagnostic: MsgDiagnostic) => void,
  ): Promise<MsgBody> {
    const body: MsgBody = {};
    let usedBytes = existingResultBytes;
    const charge = (value?: string): void => {
      if (maxResultBytes === undefined || value === undefined) return;
      const bytes = Buffer.byteLength(value);
      if (bytes > maxResultBytes - usedBytes) {
        throw new RangeError(`MSG result exceeds maxResultBytes (${maxResultBytes})`);
      }
      usedBytes += bytes;
    };
    const primary = await this.properties.readString(['1000']);
    const fallback = primary && this.isBody(primary) ? primary : await this.properties.readString(['8010']);
    if (fallback && this.isBody(fallback)) {
      body.text = fallback;
      charge(fallback);
    }

    const html = await this.properties.read(['1013'], { preferBinary: true });
    if (typeof html === 'string') body.html = html;
    if (Buffer.isBuffer(html)) {
      try {
        body.html = await this.decodeHtml(html);
      } catch (error) {
        if (error instanceof RangeError) throw error;
        onDiagnostic?.({ code: 'HTML_DECODE_FAILED', message: 'Unable to decode HTML body' });
        this.logger.warn('Unable to decode HTML body', error);
      }
    }
    charge(body.html);
    if (!body.text && body.html) {
      body.text = this.htmlToText(body.html);
      charge(body.text);
    }

    const rtf = await this.properties.read(['1009'], { preferBinary: true });
    if (Buffer.isBuffer(rtf) && rtf.length) {
      try {
        body.rtf = decompressRtf(rtf, maxRtfBytes,
          maxResultBytes === undefined ? undefined : maxResultBytes - usedBytes);
        charge(body.rtf);
      } catch (error) {
        if (error instanceof RangeError) throw error;
        onDiagnostic?.({ code: 'RTF_DECODE_FAILED', message: 'Unable to decompress RTF body' });
        this.logger.warn('Unable to decompress RTF body', error);
      }
    }
    return body;
  }

  private async decodeHtml(value: Buffer): Promise<string> {
    if (value.length >= 2 && value[0] === 0xff && value[1] === 0xfe) {
      return trimNullPadding(value.subarray(2).toString('utf16le'));
    }
    if (value.length >= 2 && value[0] === 0xfe && value[1] === 0xff) {
      const converted = Buffer.alloc(value.length - 2);
      for (let index = 2; index + 1 < value.length; index += 2) {
        converted[index - 2] = value[index + 1];
        converted[index - 1] = value[index];
      }
      return trimNullPadding(converted.toString('utf16le'));
    }
    if (value.length >= 3 && value[0] === 0xef && value[1] === 0xbb && value[2] === 0xbf) {
      return trimNullPadding(value.subarray(3).toString('utf8'));
    }
    if (this.isLikelyUtf16Le(value)) {
      return trimNullPadding(value.toString('utf16le'));
    }
    const codepage = await this.codePageReader.getCodepage();
    return trimNullPadding(this.decoder.decodeBytes(value, codepage));
  }

  private isLikelyUtf16Le(value: Buffer): boolean {
    let pairs = 0;
    let zeroHighBytes = 0;
    for (let index = 1; index < value.length; index += 2) {
      // NUL terminators and stream padding do not indicate a text encoding.
      if (value[index - 1] === 0 && value[index] === 0) continue;
      pairs += 1;
      if (value[index] === 0) zeroHighBytes += 1;
    }
    return pairs > 0 && zeroHighBytes / pairs > 0.3;
  }

  private htmlToText(html: string): string {
    const withoutMarkup = this.stripHtmlTags(this.removeHtmlSections(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(address|article|blockquote|div|footer|h[1-6]|header|li|main|p|pre|section|table|tr)>/gi, '\n'))
      .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, code: string) => {
        const value = code[0].toLowerCase() === 'x'
          ? Number.parseInt(code.slice(1), 16)
          : Number.parseInt(code, 10);
        const isUnicodeScalar = Number.isFinite(value)
          && value > 0
          && value <= 0x10ffff
          && (value < 0xd800 || value > 0xdfff);
        return isUnicodeScalar ? String.fromCodePoint(value) : '\ufffd';
      })
      .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_match, entity: string) => ({
        nbsp: ' ',
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
      })[entity.toLowerCase()] ?? '');

    return withoutMarkup
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.replace(/[\t ]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  }

  private removeHtmlSections(html: string): string {
    const opening = /<(script|style|head)\b/gi;
    const closing: Record<string, RegExp> = {
      script: /<\/script>/gi,
      style: /<\/style>/gi,
      head: /<\/head>/gi,
    };
    const unclosed = new Set<string>();
    const parts: string[] = [];
    let position = 0;
    let tagEnd = -1;
    let match: RegExpExecArray | null;
    while ((match = opening.exec(html)) !== null) {
      const name = match[1].toLowerCase();
      // Each closing-tag search advances, or is exhausted once per tag name.
      if (unclosed.has(name)) continue;
      if (tagEnd < opening.lastIndex) tagEnd = html.indexOf('>', opening.lastIndex);
      if (tagEnd === -1) break;
      const end = closing[name];
      end.lastIndex = tagEnd + 1;
      if (!end.exec(html)) {
        unclosed.add(name);
        continue;
      }
      parts.push(html.slice(position, match.index));
      position = end.lastIndex;
      opening.lastIndex = position;
    }
    parts.push(html.slice(position));
    return parts.join('');
  }

  private stripHtmlTags(html: string): string {
    const parts: string[] = [];
    let position = 0;
    let start = html.indexOf('<');
    while (start !== -1) {
      // Like <[^>]+>, keep literal <> pairs and an unclosed trailing tag.
      if (html[start + 1] === '>') {
        start = html.indexOf('<', start + 2);
        continue;
      }
      const end = html.indexOf('>', start + 1);
      if (end === -1) break;
      parts.push(html.slice(position, start), ' ');
      position = end + 1;
      start = html.indexOf('<', position);
    }
    parts.push(html.slice(position));
    return parts.join('');
  }

  private isBody(value: string): boolean {
    const text = value.trim();
    if (!text) return false;
    return !(text.startsWith('<') && text.endsWith('>') && text.includes('@') && text.length < 200);
  }
}
