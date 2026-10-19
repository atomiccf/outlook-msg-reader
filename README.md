# outlook-msg-reader

A TypeScript library for reading Microsoft Outlook `.msg` files. No runtime dependencies.

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

## Partial results and diagnostics

HTML decoding and RTF decompression failures are reported in `message.diagnostics`. Other available body formats are preserved.

```ts
const message = await parseMsg('email.msg');
for (const diagnostic of message.diagnostics ?? []) {
  console.warn(diagnostic.code, diagnostic.message);
}
```

Diagnostic codes are `HTML_DECODE_FAILED` and `RTF_DECODE_FAILED`. The `diagnostics` field is omitted when there are no recoverable failures.

With `createMsgReader()`, call `reader.getDiagnostics()` after awaiting `getBody()` or `parse()`. Other parsing errors, exceeded limits, and cancellation reject the operation.

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

Both APIs accept `MsgReaderOptions` to limit input size, attachments, recipients, result size, decompressed RTF, and embedded-message depth:

```ts
const message = await parseMsg('email.msg', {
  maxInputBytes: 50 * 1024 * 1024,
  maxResultBytes: 100 * 1024 * 1024,
  maxRtfBytes: 10 * 1024 * 1024,
  maxRecipients: 500,
  signal: AbortSignal.timeout(5000),
});
```

`maxAttachmentBytes` limits each buffered file attachment; `maxAttachments` and `maxEmbeddedMessageDepth` limit attachment count and nesting. `maxResultBytes` counts UTF-8 string and Buffer payload bytes, including diagnostics; it does not cap total memory use.

Stream input moves to a temporary file after 8 MiB by default, configurable with `streamMemoryThreshold`.

`signal` cancels asynchronous input waits, including attachment reads, but cannot interrupt synchronous parsing. Cancellation destroys stream input and removes temporary files. Size limits alone do not impose a timeout.