import type { InputSourceOptions } from '../cfb/InputSource';

export const DEFAULT_MAX_EMBEDDED_MESSAGE_DEPTH = 16;
export const DEFAULT_MAX_ATTACHMENTS = 1000;
export const DEFAULT_MAX_RESULT_BYTES = 256 * 1024 * 1024;

export interface MsgReaderOptions extends InputSourceOptions {
  /** Maximum size of one file attachment buffered by getAttachments()/parseMsg(). */
  maxAttachmentBytes?: number;
  /** Maximum number of attachments in one message. Defaults to 1000. */
  maxAttachments?: number;
  /** Maximum combined UTF-8 string and Buffer payload bytes in a parsed result. Defaults to 256 MiB. */
  maxResultBytes?: number;
  /** Maximum decompressed size of an RTF body. Defaults to 64 MiB. */
  maxRtfBytes?: number;
  /** Maximum number of nested embedded messages. Defaults to 16. */
  maxEmbeddedMessageDepth?: number;
}
