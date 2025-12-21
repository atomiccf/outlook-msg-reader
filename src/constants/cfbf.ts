export class CFBFConstants {
    readonly CFBF_SIGNATURE = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    readonly HEADER_SIZE = 512;
    readonly DEFAULT_SECTOR_SIZE = 512;
    readonly DEFAULT_MINI_SECTOR_SIZE = 64;
    readonly END_OF_CHAIN = 0xFFFFFFFE;
    readonly FREE_SECTOR = 0xFFFFFFFF;
    readonly DIFAT_SECTOR = 0xFFFFFFFD;
    readonly FAT_SECTOR = 0xFFFFFFFC;
}
