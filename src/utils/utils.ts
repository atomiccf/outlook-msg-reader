export function parseUint32Array(buffer: Buffer): number[] {
    const result: number[] = [];
    for (let i = 0; i < buffer.length; i += 4) {
        result.push(buffer.readUInt32LE(i));
    }
    return result;
}