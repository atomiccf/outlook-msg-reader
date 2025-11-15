import { describe, it, expect } from 'vitest';
import { parseMsg } from '../src';

describe('parseMsg', () => {
    it('should return a Msg object', async () => {
        const buffer = Buffer.from('');
        const msg = await parseMsg(buffer);
        expect(msg.subject).toBe('Test email');
        expect(msg.body.text).toBe('Hello, world!');
    });
});
