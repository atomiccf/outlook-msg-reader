# outlook-msg-reader

A TypeScript library for reading Microsoft Outlook `.msg` files. No runtime dependencies.

[Try the live demo](https://atomiccf.github.io/outlook-msg-reader/) to open an Outlook `.msg` file directly in your browser.

## Install

Requires Node.js 22.12.0 or newer. Supports ESM `import` and CommonJS `require()`.

```bash
npm install outlook-msg-reader
```

## Quick start

```ts
import { parseMsg } from 'outlook-msg-reader';

const message = await parseMsg('email.msg');
console.log(message.subject, message.from, message.body.text);

for (const attachment of message.attachments) {
  console.log(attachment.kind, attachment.name);
}
```

`parseMsg()` accepts a file path, `Buffer`, or Node.js `Readable`. It returns the message, recipients, body formats, and attachments. ANSI and Unicode MSG files are supported.

The body is available as `body.text`, `body.html`, and `body.rtf`. Missing text and encapsulated HTML are extracted from RTF when possible.

## Message dates

`parseMsg()` includes message dates in `message.metadata`:

| Field | Meaning |
| --- | --- |
| `sentAt` | When the message was sent |
| `receivedAt` | When the message was delivered |
| `createdAt` | When the message object was created |
| `modifiedAt` | When the message object was last modified |

Each field is a JavaScript `Date` when the MSG contains a valid value, or `undefined` otherwise. A message can have a creation date even if it has no sent date.

```ts
const message = await parseMsg('email.msg');
console.log(message.metadata?.sentAt?.toISOString());
console.log(message.metadata?.createdAt?.toISOString());
```

With `createMsgReader()`, call `await reader.getMetadata()` to read the dates without parsing the whole message.

## Diagnostics

Recoverable body errors are reported in `message.diagnostics`; available content is preserved.

```ts
const message = await parseMsg('email.msg');
for (const diagnostic of message.diagnostics ?? []) {
  console.warn(diagnostic.code, diagnostic.message);
}
```

## Large attachments

Use `createMsgReader()` to inspect attachments without loading every file into memory:

```ts
import { createMsgReader } from 'outlook-msg-reader';

const reader = await createMsgReader('email.msg');
try {
  const attachments = await reader.getAttachmentInfos();
  for (const attachment of attachments) {
    if (attachment.kind === 'file') {
      const { content } = await reader.openAttachment(attachment.index);
      let bytes = 0;
      for await (const chunk of content) {
        bytes += chunk.length;
      }
      console.log(attachment.name, bytes);
    } else {
      const nested = await reader.getEmbeddedMessage(attachment.index);
      console.log(nested.subject);
    }
  }
} finally {
  await reader.close();
}
```

## Limits and cancellation

Both APIs accept size limits and an `AbortSignal` through `MsgReaderOptions`:

```ts
const message = await parseMsg('email.msg', {
  maxInputBytes: 50 * 1024 * 1024,
  maxResultBytes: 100 * 1024 * 1024,
  signal: AbortSignal.timeout(5000),
});
```
