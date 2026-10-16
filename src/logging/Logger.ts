export interface Logger {
  debug(message: string, ...context: unknown[]): void;
  warn(message: string, ...context: unknown[]): void;
}

export class NoopLogger implements Logger {
  debug(): void {}
  warn(): void {}
}
