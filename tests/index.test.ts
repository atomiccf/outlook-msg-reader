import { describe, expect, it } from 'vitest';
import { InvalidCfbfError, parseMsg } from '../src';

describe('public API', () => {
    it('rejects input that is not a CFBF document', async () => {
        await expect(parseMsg(Buffer.alloc(512))).rejects.toBeInstanceOf(InvalidCfbfError);
    });
});
