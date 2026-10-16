# msg

A dependency-free TypeScript library for reading Microsoft Outlook `.msg` files.

## Installation

```bash
npm install msg
```

## Usage

```ts
import { parseMsg, createMsgReader } from 'msg';
import { createReadStream, createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';

const message = await parseMsg('email.msg');
console.log(message.subject);

const reader = await createMsgReader('email.msg');
const attachments = await reader.getAttachmentInfos();
if (attachments[0]?.kind === 'file') {
  const attachment = await reader.openAttachment(attachments[0].index);
  await finished(attachment.content.pipe(createWriteStream(attachment.name)));
}
if (attachments[0]?.kind === 'embedded-message') {
  const nestedMessage = await reader.getEmbeddedMessage(attachments[0].index);
  console.log(nestedMessage.subject);
}
await reader.close();

const streamedMessage = await parseMsg(createReadStream('email.msg'), {
  streamMemoryThreshold: 8 * 1024 * 1024,
  maxInputBytes: 512 * 1024 * 1024,
  maxAttachmentBytes: 64 * 1024 * 1024,
  maxAttachments: 100,
  maxResultBytes: 128 * 1024 * 1024,
  maxRtfBytes: 64 * 1024 * 1024,
  maxDirectoryDepth: 128,
  maxEmbeddedMessageDepth: 16,
});
```

Both functions accept a file path, a `Buffer`, or a Node.js `Readable` stream. Readable input is
buffered in memory up to `streamMemoryThreshold` (8 MiB by default), then moved to a temporary
random-access file. `maxInputBytes` rejects oversized buffers, files, and stream input.
`parseMsg` returns the subject, sender,
recipients, available body formats, and attachments. `createMsgReader` allows individual
parts to be read on demand; call `reader.close()` when it and any attachment streams are no longer
needed. `getAttachments()` returns a discriminated union: file attachments include a `content`
buffer, while embedded messages expose metadata and an `index`. For large files, use
`getAttachmentInfos()` and `openAttachment(index)`. Embedded messages are parsed with
`getEmbeddedMessage(index)`. Set `maxAttachmentBytes` to prevent the buffer-based API from
materializing an oversized individual file attachment.
`maxAttachments` limits the number of attachments in one message (1000 by default).
`maxResultBytes` limits the combined UTF-8 byte length of string values and the byte length of
buffers returned by `parseMsg()` (256 MiB by default);
it also limits the attachment payload returned by `getAttachments()`.
Decompressed RTF is limited to 64 MiB by default; set `maxRtfBytes` to choose a different limit.
CFBF directories are limited to 128 nested levels and embedded messages to 16 levels by default;
set `maxDirectoryDepth` and `maxEmbeddedMessageDepth` to choose different limits.

## Errors

Structural and decoding failures are exposed as subclasses of `MsgError`, including
`InvalidCfbfError`, `CorruptedSectorChainError`, and `PropertyDecodeError`.

Compressed RTF bodies are decompressed. Embedded MSG attachments are identified, but their
nested message structure is not parsed yet.
