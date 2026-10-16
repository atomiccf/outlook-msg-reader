# msg

A dependency-free TypeScript library for reading Microsoft Outlook `.msg` files.

## Installation

```bash
npm install msg
```

## Usage

```ts
import { parseMsg, createMsgReader } from 'msg';

const message = await parseMsg('email.msg');
console.log(message.subject);

const reader = await createMsgReader('email.msg');
const attachments = await reader.getAttachments();
```

Both functions accept a file path or a `Buffer`. `parseMsg` returns the subject, sender,
recipients, available body formats, and attachments. `createMsgReader` allows individual
parts to be read on demand. Attachments expose a `kind` of `file` or `embedded-message`.

## Errors

Structural and decoding failures are exposed as subclasses of `MsgError`, including
`InvalidCfbfError`, `CorruptedSectorChainError`, and `PropertyDecodeError`.

Compressed RTF bodies are decompressed. Embedded MSG attachments are identified, but their
nested message structure is not parsed yet.
