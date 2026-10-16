# msg

A dependency-free TypeScript library for reading Microsoft Outlook `.msg` files.

## Installation

```bash
npm install msg
```

## Usage

```ts
import { parseMsg, createMsgReader } from 'msg';
import { createReadStream } from 'node:fs';

const message = await parseMsg('email.msg');
console.log(message.subject);

const reader = await createMsgReader('email.msg');
const attachments = await reader.getAttachments();
await reader.close();

const streamedMessage = await parseMsg(createReadStream('email.msg'));
```

Both functions accept a file path, a `Buffer`, or a Node.js `Readable` stream. Stream input is
buffered incrementally so the compound-file parser can perform the random reads required by CFBF.
`parseMsg` returns the subject, sender,
recipients, available body formats, and attachments. `createMsgReader` allows individual
parts to be read on demand; call `reader.close()` when it is no longer needed. Attachments expose
a `kind` of `file` or `embedded-message`.

## Errors

Structural and decoding failures are exposed as subclasses of `MsgError`, including
`InvalidCfbfError`, `CorruptedSectorChainError`, and `PropertyDecodeError`.

Compressed RTF bodies are decompressed. Embedded MSG attachments are identified, but their
nested message structure is not parsed yet.
