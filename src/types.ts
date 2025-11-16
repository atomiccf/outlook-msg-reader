export interface MsgAttachment {
    name: string;
    mime: string;
    content: Buffer;
}

export interface MsgBody {
    text?: string;
    html?: string;
    rtf?: string;
}

export interface Msg {
    subject: string;
    from: { name: string; email: string };
    to: Array<{ name: string; email: string }>;
    cc?: Array<{ name: string; email: string }>;
    body: MsgBody;
    attachments: MsgAttachment[];
}

export interface HeaderInfo {
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

