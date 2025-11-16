import { describe, it, expect } from 'vitest';
import { loadDirectory, parseMsg } from '../src';

describe('loadDirectory', () => {
    it('should load CFBF directory tree from sample .msg', async () => {
        const { tree } = await loadDirectory('sample/sample.msg');
        expect(tree).toBeTruthy();
        expect(tree?.type).toBeDefined();
    });
});

describe('parseMsg', () => {
    it('should parse basic MSG fields without throwing', async () => {
        const msg = await parseMsg('sample/sample.msg');
        expect(msg).toHaveProperty('subject');
        expect(msg).toHaveProperty('from');
        expect(msg).toHaveProperty('body');
        expect(msg).toHaveProperty('attachments');
    });
});
