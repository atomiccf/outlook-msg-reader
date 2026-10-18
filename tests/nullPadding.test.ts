import { describe, expect, it } from 'vitest';
import { trimNullPadding } from '../src/utils/utils';

describe('NUL padding', () => {
  it.each([
    ['', ''], ['\0', ''], ['\0'.repeat(32_000), ''],
    [' value \0\0', ' value '], ['a\0b\0', 'a\0b'],
    ['\0'.repeat(32_000) + 'X', '\0'.repeat(32_000) + 'X'],
  ])(
    'removes only the trailing NUL suffix (case %#)', (value, expected) => {
      const start = performance.now();
      const result = trimNullPadding(value);
      expect(performance.now() - start).toBeLessThan(1000);
      expect(result).toBe(expected);
    },
  );
});
