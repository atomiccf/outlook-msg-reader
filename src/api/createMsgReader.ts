import { container } from '../di/container';
import { TOKENS } from '../di/tokens';
import type { MsgReader } from '../msg/MsgReader';
import type { InputSource } from '../cfb/InputSource';
import type { MsgReaderOptions } from './options';

export async function createScopedMsgReader(
  input: InputSource,
  options: MsgReaderOptions = {},
): Promise<MsgReader> {
  const scope = container.createScope();
  const cfbReader = scope.get(TOKENS.cfbReader);
  try {
    await cfbReader.load(input, options);
    const reader = scope.get(TOKENS.msgReader);
    reader.configure(options);
    return reader;
  } catch (error) {
    await cfbReader.close();
    throw error;
  }
}
