import { parseMsg } from '../src/index.ts';

export const maxFileSize = 100 * 1024 * 1024;

export async function parseMessageFile(file) {
  if (file.size === 0) throw new Error('The file is empty.');
  if (file.size > maxFileSize) throw new Error('The file exceeds 100 MiB.');
  const message = await parseMsg(Buffer.from(await file.arrayBuffer()), { maxInputBytes: maxFileSize });
  return { ...message, fileName: file.name, fileSize: file.size, metadata: message.metadata ?? {} };
}
