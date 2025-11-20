export function parseUint32Array(buffer: Buffer): number[] {
    const result: number[] = [];
    for (let i = 0; i < buffer.length; i += 4) {
        result.push(buffer.readUInt32LE(i));
    }
    return result;
}

export function bufToUnicode(buf: Buffer | null): string | undefined {
    if (!buf) return undefined;
    let s = buf.toString('utf16le');
    s = s.replace(/\u0000+$/g, '');
    return s || undefined;
}

export function pad2(n: number): string {
    const s = String(n);
    return s.length === 1 ? '0' + s : s;
}
