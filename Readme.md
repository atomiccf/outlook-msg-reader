# outlook-msg-reader

A dependency-free TypeScript library for reading Microsoft Outlook `.msg` files.

## Installation

```bash
npm install outlook-msg-reader
```

## Usage

```ts
import { parseMsg, createMsgReader } from 'outlook-msg-reader';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';

const message = await parseMsg('email.msg');
console.log(message.subject);

const reader = await createMsgReader('email.msg');
const attachments = await reader.getAttachmentInfos();
if (attachments[0]?.kind === 'file') {
  const attachment = await reader.openAttachment(attachments[0].index);
  const attachmentDirectory = resolve('attachments');
  await mkdir(attachmentDirectory, { recursive: true });
  const sourceName = attachment.name.split(/[\\/]/).pop() ?? '';
  const safeName = sourceName
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+$/, '') || `attachment-${attachment.index}`;
  const target = join(attachmentDirectory, `${attachment.index}-${safeName}`);
  await finished(attachment.content.pipe(createWriteStream(target, { flags: 'wx' })));
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
random-access file. `maxInputBytes` rejects oversized buffers, files, and stream input (512 MiB by default).
`Readable` input is consumed on demand; `parseMsg()` checks any unread trailing bytes before returning.
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
it also limits the attachment payload returned by `getAttachments()` and rejects individual
buffered streams whose declared size exceeds the limit before reading them. Use `openAttachment()`
to stream a larger file attachment.
Decompressed RTF is limited to 64 MiB by default; set `maxRtfBytes` to choose a different limit.
CFBF directories are limited to 128 nested levels and embedded messages to 16 levels by default;
set `maxDirectoryDepth` and `maxEmbeddedMessageDepth` to choose different limits.
The CFBF directory byte stream is capped at 32 MiB before it is buffered; use
`maxDirectoryBytes` to choose a different limit.

## Errors

Structural and decoding failures are exposed as subclasses of `MsgError`, including
`InvalidCfbfError`, `CorruptedSectorChainError`, and `PropertyDecodeError`.

Compressed RTF bodies and embedded MSG attachments are parsed.

## Generating MSG fixtures

Generate the local MSG corpus with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\generate-outlook-fixtures.ps1
```

The default `Auto` engine uses Microsoft Outlook classic when it is available. With New Outlook,
it falls back to the independent MsgKit writer and requires the .NET 8 SDK. Install the SDK with
`winget install Microsoft.DotNet.SDK.8`, then restart the terminal and run the command again.

Choose an engine explicitly when needed:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\generate-outlook-fixtures.ps1 -Engine MsgKit
powershell -ExecutionPolicy Bypass -File scripts\generate-outlook-fixtures.ps1 -Engine Outlook
```

Both engines write synthetic messages and a SHA-256 manifest to
`tests/fixtures/valid/outlook`. ANSI and true embedded-message fixtures are generated only by
the Outlook engine because MsgKit does not produce equivalent fixtures.

To generate MSG files with actual 10, 100, and 300 MiB binary attachments, use the MsgKit
generator with an empty output directory:

```powershell
dotnet run --project scripts/MsgFixtureGenerator/MsgFixtureGenerator.csproj -- sample/my-large-msg --large 10 100 300
```

The command creates one MSG and one source attachment per size, plus `large-manifest.json` with
SHA-256 hashes for both files. Sizes are attachment sizes in MiB, not exact MSG file sizes; allowed
values are distinct integers from 1 to 400. These files contain real attachment streams rather
than zero padding after a small MSG. The `sample` directory is ignored by Git. A 300 MiB attachment
exceeds the default `parseMsg()` result limit of 256 MiB, so test it with `createMsgReader()` and
`openAttachment()` as shown above. This MsgKit corpus tests large data streams; use Outlook classic
when testing Outlook-specific formatting and compatibility.

Create an HTML report for manual inspection of every parsed field:

```powershell
npm run inspect:fixtures
```

Open `tests/fixtures/report.html`. Green cards match `manifest.json`; red rows show the expected
and parsed values side by side. Attachments can be downloaded directly from the report.
Use `npm run check:fixtures` when a non-zero exit code is required for automated checks.
The committed corpus is also parsed by the normal test suite and checked in CI. MsgKit fixtures
cover Unicode MSG, plain/HTML/RTF bodies, recipients, and file attachments. Outlook classic
fixtures cover ANSI MSG and a message with an embedded Outlook message. The ANSI fixture text
reflects the code-page conversion performed by Outlook on the machine that generated it.

To inspect every `.msg` file in an arbitrary directory without a manifest, pass the input and
report paths after `--`:

```powershell
npm run inspect:fixtures -- sample sample/report.html
```
