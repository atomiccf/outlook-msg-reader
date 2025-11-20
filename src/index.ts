import { MsgReader } from './msg/MsgReader';
import type { Msg } from './types';

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
export async function parseMsg(filePath: string): Promise<Msg> {
    const reader = await MsgReader.fromFile(filePath);
    return reader.parse();
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
export async function createMsgReader(filePath: string): Promise<MsgReader> {
    return MsgReader.fromFile(filePath);
}

// Export classes for maximum flexibility
export { MsgReader } from './msg/MsgReader';
export { CFBFReader, CFBFReaderFactory } from './сfb/CFBReader';

// Export types
export type { 
    Msg, 
    MsgBody, 
    MsgAttachment,
    DirectoryNode,
    HeaderInfo,
    DirectoryEntryType,
    DirectoryEntryRaw
} from './types';

export type { SupportedCodePage } from './encoding/decoder';
