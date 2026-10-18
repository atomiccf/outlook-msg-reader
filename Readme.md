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

## Partial results and diagnostics

HTML decoding and RTF decompression are tolerant: when either fails, the parser keeps the other available body formats and reports the failure in `message.diagnostics`. An absent body format without a diagnostic means no decoding failure was encountered for that format.

```ts
const message = await parseMsg('email.msg');
for (const diagnostic of message.diagnostics ?? []) {
  console.warn(diagnostic.code, diagnostic.message);
}
```

Diagnostics have the exported `MsgDiagnostic` type with a stable `code` (`HTML_DECODE_FAILED` or `RTF_DECODE_FAILED`) and a human-readable `message`. The `diagnostics` field is omitted when no recoverable failures were encountered. Diagnostic strings count toward `maxResultBytes`.

With `createMsgReader()`, call `reader.getDiagnostics()` after awaiting `getBody()` or `parse()`. It returns a snapshot of failures encountered so far; it does not trigger parsing. Repeated reads do not duplicate diagnostics. Embedded messages returned by `getEmbeddedMessage()` carry their own diagnostics. Errors outside tolerant body decoding, resource-limit violations, and cancellation still reject rather than returning a partial result.

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

Both APIs accept optional limits such as `maxInputBytes`, `maxAttachmentBytes`, `maxAttachments`, `maxRecipients`, `maxResultBytes`, and `maxEmbeddedMessageDepth`. `maxRecipients` defaults to 1000 per message and covers recipient storages and display-address fallbacks across To/Cc/Bcc. Result budgets count UTF-8 string bytes and Buffer bytes; RTF decompression is also bounded by the remaining result budget. Stream input moves to a temporary file after 8 MiB by default. Parsing and decoding errors extend `MsgError`.

Pass `signal` to cancel input reads, including a stream waiting for its next chunk. Cancellation destroys the input stream and removes temporary files before the read rejects with `signal.reason`. For example, an application can apply a timeout:

```ts
const message = await parseMsg(stream, {
  signal: AbortSignal.timeout(5000),
  maxRecipients: 500,
});
```

The signal applies to the lifetime of a reader returned by `createMsgReader()`, including attachment reads. Synchronous parsing work does not yield to abort events; this timeout interrupts asynchronous input waits.

The size limits alone do not provide a timeout or cancellation: a stream that never ends can keep a read pending. `maxResultBytes` limits the combined UTF-8 string and Buffer payload bytes in a parsed result, not peak memory use or raw CFBF stream sizes. Internal property tables, source encodings, and stream padding do not count toward this budget. Use `maxInputBytes` to limit input size and `maxRtfBytes` to limit decompressed RTF separately.

Returned HTML is not sanitized. Applications must render it safely. For untrusted messages, consider isolating parsing in a worker or process with application-managed time and memory limits.

The internal `src/cfb` layer reads compound-file streams as bytes. MAPI property types, MSG code pages, and embedded-message storage rules live above it. The public `CFBFReader` export retains `readStreamAsString()` through a MAPI adapter for API compatibility.

Run `npm test` to check the MSG fixtures, including Outlook classic ANSI and embedded-message samples.
