import { MsgReader } from './msg/MsgReader';
import type { Msg } from './types';
import { createScopedMsgSession } from './api/createMsgReader';
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
    const { reader, cfbReader } = await createScopedMsgSession(input, options);
    try {
        const message = await reader.parse();
        await cfbReader.finishInput();
        return message;
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
    return (await createScopedMsgSession(input, options)).reader;
}

// Export classes for maximum flexibility
export { MsgReader } from './msg/MsgReader';
export { MapiCFBFReader as CFBFReader } from './mapi/MapiCFBFReader';
export { MsgError, InvalidCfbfError, CorruptedSectorChainError, PropertyDecodeError, UnsupportedPropertyTypeError, UnsupportedMsgFeatureError } from './errors/errors';

// Export types
export type { 
    Msg, 
    MsgBody, 
    MsgDiagnostic,
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
