import { container } from '../di/container';
import { TOKENS } from '../di/tokens';
import type { MsgReader } from '../msg/MsgReader';
import type { InputSource } from '../cfb/InputSource';

export async function createScopedMsgReader(input: InputSource): Promise<MsgReader> {
  const scope = container.createScope();
  const cfbReader = scope.get(TOKENS.cfbReader);
  try {
    await cfbReader.load(input);
    await scope.get(TOKENS.namedPropertyReader).initialize();
    return scope.get(TOKENS.msgReader);
  } catch (error) {
    await cfbReader.close();
    throw error;
  }
}
