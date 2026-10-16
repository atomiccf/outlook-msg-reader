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

Create an HTML report for manual inspection of every parsed field:

```powershell
npm run inspect:fixtures
```

Open `tests/fixtures/report.html`. Green cards match `manifest.json`; red rows show the expected
and parsed values side by side. Attachments can be downloaded directly from the report.
Use `npm run check:fixtures` when a non-zero exit code is required for automated checks.

To inspect every `.msg` file in an arbitrary directory without a manifest, pass the input and
report paths after `--`:

```powershell
npm run inspect:fixtures -- sample sample/report.html
```
