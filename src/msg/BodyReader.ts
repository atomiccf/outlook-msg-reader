import type { Logger } from '../logging/Logger';
import type { PropertyStore } from '../mapi/PropertyStore';
import type { MsgBody } from '../types';
import { decompressRtf } from '../rtf/decompressRtf';
import type { Decoder } from '../encoding/decoder';
import type { CodePageReader } from '../mapi/CodePageReader';

export class BodyReader {
  constructor(
    private readonly properties: PropertyStore,
    private readonly logger: Logger,
    private readonly decoder: Decoder,
    private readonly codePageReader: CodePageReader,
  ) {}

  async read(maxRtfBytes?: number, maxResultBytes?: number, existingResultBytes = 0): Promise<MsgBody> {
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
        body.rtf = decompressRtf(rtf, maxRtfBytes);
        charge(body.rtf);
      } catch (error) {
        if (error instanceof RangeError) throw error;
        this.logger.warn('Unable to decompress RTF body', error);
      }
    }
    return body;
  }

  private async decodeHtml(value: Buffer): Promise<string> {
    if (value.length >= 2 && value[0] === 0xff && value[1] === 0xfe) {
      return value.subarray(2).toString('utf16le').replace(/\u0000+$/g, '');
    }
    if (value.length >= 2 && value[0] === 0xfe && value[1] === 0xff) {
      const converted = Buffer.alloc(value.length - 2);
      for (let index = 2; index + 1 < value.length; index += 2) {
        converted[index - 2] = value[index + 1];
        converted[index - 1] = value[index];
      }
      return converted.toString('utf16le').replace(/\u0000+$/g, '');
    }
    if (value.length >= 3 && value[0] === 0xef && value[1] === 0xbb && value[2] === 0xbf) {
      return value.subarray(3).toString('utf8').replace(/\u0000+$/g, '');
    }
    if (this.isLikelyUtf16Le(value)) {
      return value.toString('utf16le').replace(/\u0000+$/g, '');
    }
    const codepage = await this.codePageReader.getCodepage();
    return this.decoder.decodeBytes(value, codepage).replace(/\u0000+$/g, '');
  }

  private isLikelyUtf16Le(value: Buffer): boolean {
    const pairs = Math.floor(value.length / 2);
    if (pairs === 0) return false;
    let zeroHighBytes = 0;
    for (let index = 1; index < pairs * 2; index += 2) {
      if (value[index] === 0) zeroHighBytes += 1;
    }
    return zeroHighBytes / pairs > 0.3;
  }

  private htmlToText(html: string): string {
    const withoutMarkup = html
      .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(address|article|blockquote|div|footer|h[1-6]|header|li|main|p|pre|section|table|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
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

  private isBody(value: string): boolean {
    const text = value.trim();
    if (!text) return false;
    return !(text.startsWith('<') && text.endsWith('>') && text.includes('@') && text.length < 200);
  }
}
