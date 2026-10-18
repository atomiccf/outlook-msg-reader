import { container } from '../di/container';
import { TOKENS } from '../di/tokens';
import type { MsgReader } from '../msg/MsgReader';
import type { CFBFReader } from '../cfb/CFBReader';
import type { InputSource } from '../cfb/InputSource';
import type { MsgReaderOptions } from './options';

export async function createScopedMsgSession(
  input: InputSource,
  options: MsgReaderOptions = {},
): Promise<{ reader: MsgReader; cfbReader: CFBFReader }> {
  const scope = container.createScope();
  const cfbReader = scope.get(TOKENS.cfbReader);
  try {
    await cfbReader.load(input, options);
    const reader = scope.get(TOKENS.msgReader);
    reader.configure(options);
    return { reader, cfbReader };
  } catch (error) {
    await cfbReader.close();
    throw error;
  }
}
