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

The body is available as `body.text`, `body.html`, and `body.rtf`. Text and HTML can also be available when the original body is RTF.

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

Recoverable body and calendar decoding errors are reported in `message.diagnostics`. Available content is preserved. For on-demand reads, use `reader.getDiagnostics()`.

```ts
const message = await parseMsg('email.msg');
for (const diagnostic of message.diagnostics ?? []) {
  console.warn(diagnostic.code, diagnostic.message);
}
```

## Calendar data

`parseMsg()` includes `message.calendar` for Outlook appointments, meeting requests, cancellations and responses. Use `getCalendar()` to read those properties without loading the body or attachments.

```ts
import { createMsgReader } from 'outlook-msg-reader';

const reader = await createMsgReader('meeting.msg');
try {
  const calendar = await reader.getCalendar();
  console.log(calendar?.startAt, calendar?.endAt, calendar?.location);
} finally {
  await reader.close();
}
```

`startAt` and `endAt` are JavaScript `Date` objects when available. For a recurring series, they refer to its first occurrence. For all-day events, `allDay` carries Outlook's flag. Use the applicable Outlook time zone to interpret the local date of a floating event. An `.ics` attached to an ordinary email is returned as a file with its original bytes.

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
      console.log(attachment.name, bytes, attachment.contentId);
    } else {
      const nested = await reader.getEmbeddedMessage(attachment.index);
      console.log(nested.subject);
    }
  }
} finally {
  await reader.close();
}
```

To find an inline image, match the `cid:` reference in `message.body.html` against the file attachment's `contentId`, then pass its `index` to `openAttachment()`. For image files with a declared MIME type, filter by `kind === 'file'` and `mime.startsWith('image/')`.

## Limits and cancellation

Both APIs accept size limits and an `AbortSignal` through `MsgReaderOptions`:

```ts
const message = await parseMsg('email.msg', {
  maxInputBytes: 50 * 1024 * 1024,
  maxResultBytes: 100 * 1024 * 1024,
  signal: AbortSignal.timeout(5000),
});
```

## Parsing untrusted input

Set size limits and a timeout when parsing `.msg` files from untrusted senders. Sanitize `body.html` before displaying it in a browser.

See [SECURITY.md](SECURITY.md) for the threat model, defaults, and tighter settings for untrusted input.
