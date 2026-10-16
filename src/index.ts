import { MsgReader } from './msg/MsgReader';
import type { Msg } from './types';
import { createScopedMsgReader } from './api/createMsgReader';
import type { InputSource } from './cfb/InputSource';
import type { MsgReaderOptions } from './api/options';

/**
 * Simple way to parse an MSG file.
 * Convenient wrapper function over MsgReader for quick usage.
 * 
 * @example
 * ```typescript
 * const msg = await parseMsg('email.msg');
 * console.log(msg.subject);
 * console.log(msg.from.email);
 * ```
 * 
 * @param filePath - Path to the .msg file
 * @returns Parsed message object
 */
export async function parseMsg(input: InputSource, options: MsgReaderOptions = {}): Promise<Msg> {
    const reader = await createScopedMsgReader(input, options);
    try {
        return await reader.parse();
    } finally {
        await reader.close();
    }
}

/**
 * Create a MsgReader for advanced usage.
 * Allows reading parts of the MSG file on demand.
 * 
 * @example
 * ```typescript
 * const reader = await createMsgReader('email.msg');
 * const subject = await reader.getSubject();
 * const attachments = await reader.getAttachments();
 * ```
 * 
 * @param filePath - Path to the .msg file
 * @returns MsgReader instance
 */
export async function createMsgReader(
    input: InputSource,
    options: MsgReaderOptions = {},
): Promise<MsgReader> {
    return createScopedMsgReader(input, options);
}

// Export classes for maximum flexibility
export { MsgReader } from './msg/MsgReader';
export { CFBFReader } from './cfb/CFBReader';
export { MsgError, InvalidCfbfError, CorruptedSectorChainError, PropertyDecodeError, UnsupportedPropertyTypeError, UnsupportedMsgFeatureError } from './errors/errors';

// Export types
export type { 
    Msg, 
    MsgBody, 
    MsgAttachment,
    MsgFileAttachment,
    MsgEmbeddedMessageAttachment,
    MsgAttachmentInfo,
    MsgAttachmentStream,
    MsgMetadata,
    MsgImportance,
    MsgRecipient,
    DirectoryNode,
    HeaderInfo,
    DirectoryEntryType,
    DirectoryEntryRaw
} from './types';

export type { SupportedCodePage } from './encoding/decoder';
export type { InputSource, InputSourceOptions } from './cfb/InputSource';
export type { MsgReaderOptions } from './api/options';
