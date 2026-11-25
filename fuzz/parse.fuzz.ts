import { parseMsg, MsgError } from '../src';

const MAX_INPUT = 1024 * 1024;

export async function fuzz(data: Buffer): Promise<void> {
  if (data.length === 0 || data.length > MAX_INPUT) return;
  try {
    await parseMsg(Buffer.from(data), {
      maxInputBytes: data.length,
      maxResultBytes: 8 * 1024 * 1024,
      maxRtfBytes: 1024 * 1024,
    });
  } catch (error) {
    if (error instanceof MsgError || error instanceof RangeError) return;
    throw error;
  }
}
