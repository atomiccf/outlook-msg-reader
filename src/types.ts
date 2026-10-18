import type { Readable } from 'node:stream';

export interface MsgAttachmentInfo {
    index: number;
    name: string;
    mime: string;
    size: number;
    kind: 'file' | 'embedded-message';
}

export interface MsgFileAttachment extends MsgAttachmentInfo {
    kind: 'file';
    content: Buffer;
}

export interface MsgEmbeddedMessageAttachment extends MsgAttachmentInfo {
    kind: 'embedded-message';
}

export type MsgAttachment = MsgFileAttachment | MsgEmbeddedMessageAttachment;

export interface MsgAttachmentStream extends MsgAttachmentInfo {
    kind: 'file';
    content: Readable;
}

export interface MsgBody {
    text?: string;
    html?: string;
    rtf?: string;
}

/** A recoverable decoding failure that left part of the message unavailable. */
export interface MsgDiagnostic {
    code: 'HTML_DECODE_FAILED' | 'RTF_DECODE_FAILED';
    message: string;
}

export interface MsgRecipient {
    name: string;
    email: string;
}

export type MsgImportance = 'low' | 'normal' | 'high';

export interface MsgMetadata {
    messageId?: string;
    sentAt?: Date;
    receivedAt?: Date;
    transportHeaders?: string;
    importance?: MsgImportance;
}

export interface Msg {
    subject: string;
    from: MsgRecipient;
    to: MsgRecipient[];
    cc?: MsgRecipient[];
    bcc?: MsgRecipient[];
    body: MsgBody;
    attachments: MsgAttachment[];
    metadata?: MsgMetadata;
    /** Recoverable body decoding failures. Omitted when none were encountered. */
    diagnostics?: MsgDiagnostic[];
}

export interface HeaderInfo {
    /** CFBF major version validated from the header */
    majorVersion?: 3 | 4;

    /** CFBF minor version reported by the header */
    minorVersion?: number;

    /** Size of a regular sector in bytes (2^n, where n = sectorShift) */
    sectorSize: number;

    /** Size of a mini sector in bytes (2^n, where n = miniSectorShift) */
    miniSectorSize: number;

    /** Number of sectors in the Directory table (for large files) */
    numDirectorySectors: number;

    /** Index of the first Directory sector */
    dirSectorLocation: number;

    /** Number of FAT sectors */
    numFATSectors: number;

    /** Array of FAT sector indices (from DIFAT area in the header) */
    fatSectorLocations: number[];

    /** First sector in the extended DIFAT chain, or ENDOFCHAIN when absent */
    difatStartSector?: number;

    /** Number of sectors in the extended DIFAT chain */
    numDIFATSectors?: number;

    /** Cutoff size for using mini-sectors (streams smaller than this use mini-streams) */
    miniStreamCutoffSize: number;

    /** First 8 bytes of the file signature (for CFBF validation) */
    signature: Buffer;

    /** Full header buffer (512 bytes) */
    rawHeader: Buffer;
    /** Index of the first sector of the MiniFAT */
    miniFatStartSector: number;
    /** Number of sectors in the MiniFAT */
    miniFatSectorCount: number;
}

/**
 * Directory entry object type identifiers as per CFBF specification.
 */
export enum DirectoryEntryType {
    Empty = 0x00,
    Storage = 0x01,
    Stream = 0x02,
    Root = 0x05,
}

/**
 * Raw directory entry parsed from a 128-byte record.
 * Values are kept close to file format semantics.
 */
export interface DirectoryEntryRaw {
    sid: number;
    name: string;
    type: DirectoryEntryType;
    colorFlag: number;
    leftSiblingSid: number;
    rightSiblingSid: number;
    childSid: number;
    clsid: string | null;
    stateBits: number;
    creationTime?: bigint;
    modifiedTime?: bigint;
    startingSectorLocation: number;
    streamSize: number;
}

/**
 * Normalized node for convenient tree navigation.
 */
export interface DirectoryNode {
    sid: number;
    name: string;
    type: DirectoryEntryType;
    startingSectorLocation: number;
    streamSize: number;
    children: DirectoryNode[];
    parentSid: number | null;
}
