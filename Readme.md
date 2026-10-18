# outlook-msg-reader

A TypeScript library for reading Microsoft Outlook `.msg` files. No runtime dependencies.

## Install

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

Both APIs accept optional limits such as `maxInputBytes`, `maxAttachmentBytes`, `maxAttachments`, `maxResultBytes`, and `maxEmbeddedMessageDepth`. Stream input moves to a temporary file after 8 MiB by default. Parsing and decoding errors extend `MsgError`.

These limits do not provide a timeout or cancellation: a stream that never ends can keep a read pending. `maxResultBytes` limits the returned data, not peak memory use; for example, RTF is decompressed before the remaining result budget is checked. Use `maxRtfBytes` to limit decompressed RTF separately.

Returned HTML is not sanitized. Applications must render it safely. For untrusted messages, consider isolating parsing in a worker or process with application-managed time and memory limits.

Run `npm test` to check the MSG fixtures, including Outlook classic ANSI and embedded-message samples.
