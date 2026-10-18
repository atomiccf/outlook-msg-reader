/** Removes only trailing NUL padding in linear time. */
export function trimNullPadding(value: string): string {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 0) end -= 1;
    return value.slice(0, end);
}

export function parseUint32Array(buffer: Buffer): number[] {
    const result: number[] = [];
    for (let i = 0; i < buffer.length; i += 4) {
        result.push(buffer.readUInt32LE(i));
    }
    return result;
}
