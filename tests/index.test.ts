import { describe, it, expect } from 'vitest';
import { parseMsg, createMsgReader } from '../src';
import { existsSync } from 'fs';

// Skip tests if sample file doesn't exist
const SAMPLE_FILE = 'sample/sample.msg';
const skipIfNoSample = existsSync(SAMPLE_FILE) ? it : it.skip;

describe('CFBFReader', () => {
    skipIfNoSample('should load CFBF directory tree from sample .msg', async () => {
        const reader = await createMsgReader(SAMPLE_FILE);
        const cfbReader = reader.getCFBReader();
        const tree = cfbReader.getTree();
        
        expect(tree).toBeTruthy();
        expect(tree?.type).toBeDefined();
    });
});

describe('parseMsg', () => {
    skipIfNoSample('should parse basic MSG fields without throwing', async () => {
        const msg = await parseMsg(SAMPLE_FILE);
        expect(msg).toHaveProperty('subject');
        expect(msg).toHaveProperty('from');
        expect(msg).toHaveProperty('body');
        expect(msg).toHaveProperty('attachments');
    });
});

describe('MsgReader', () => {
    skipIfNoSample('should create MsgReader and read parts separately', async () => {
        const reader = await createMsgReader(SAMPLE_FILE);
        
        const subject = await reader.getSubject();
        const from = await reader.getFrom();
        const body = await reader.getBody();
        const attachments = await reader.getAttachments();
        
        expect(subject).toBeDefined();
        expect(from).toHaveProperty('name');
        expect(from).toHaveProperty('email');
        expect(body).toBeDefined();
        expect(Array.isArray(attachments)).toBe(true);
    });
});
