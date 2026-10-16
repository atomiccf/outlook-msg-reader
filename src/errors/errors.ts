export class MsgError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = new.target.name;
    this.cause = cause;
  }
}

export class InvalidCfbfError extends MsgError {}
export class CorruptedSectorChainError extends MsgError {}
export class PropertyDecodeError extends MsgError {}
export class UnsupportedPropertyTypeError extends MsgError {}
export class UnsupportedMsgFeatureError extends MsgError {}
