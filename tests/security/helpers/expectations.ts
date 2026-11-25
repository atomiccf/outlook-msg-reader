import { expect } from 'vitest';
import { MsgError } from '../../../src';

export type ErrorClass = new (...args: never[]) => Error;

export class DeadlineExceededError extends Error {
  constructor(readonly ms: number) {
    super(`exceeded deadline ${ms}ms`);
    this.name = 'DeadlineExceededError';
  }
}

export async function withDeadline<T>(ms: number, fn: () => Promise<T> | T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceededError(ms)), ms);
  });
  try {
    return await Promise.race([Promise.resolve().then(fn), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function expectControlledFailure(
  fn: () => Promise<unknown> | unknown,
  allowed: ErrorClass[],
  deadlineMs = 2000,
): Promise<Error | undefined> {
  try {
    await withDeadline(deadlineMs, fn);
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    const err = error as Error;
    if (err instanceof DeadlineExceededError) throw err;
    const permitted = allowed.some((ctor) => error instanceof ctor);
    expect(permitted, `unexpected error ${err.name}: ${err.message}`).toBe(true);
    return err;
  }
}

export const DEFAULT_ALLOWED_ERRORS: ErrorClass[] = [MsgError, RangeError];
