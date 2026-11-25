import { expect, it, vi } from 'vitest';
import { DeadlineExceededError, expectControlledFailure, withDeadline } from './expectations';

it('rejects with the deadline error and its duration', async () => {
  const pending = expectControlledFailure(() => new Promise(() => {}), [DeadlineExceededError], 20);
  await expect(pending).rejects.toBeInstanceOf(DeadlineExceededError);
  await expect(pending).rejects.toHaveProperty('ms', 20);
});

it('returns the result and clears the deadline timer', async () => {
  vi.useFakeTimers();
  try {
    await expect(withDeadline(1000, () => 'ok')).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('rejects with an assertion error for an unexpected failure', async () => {
  await expect(
    expectControlledFailure(() => {
      throw new Error('boom');
    }, [RangeError]),
  ).rejects.toThrow(expect.objectContaining({ name: 'AssertionError' }));
});

it('accepts an allowed error whose message starts with the deadline text', async () => {
  const error = new RangeError('exceeded deadline while parsing');
  await expect(
    expectControlledFailure(() => {
      throw error;
    }, [RangeError]),
  ).resolves.toBe(error);
});
