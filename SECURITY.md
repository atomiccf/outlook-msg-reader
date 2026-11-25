# Security

This library parses untrusted Microsoft Outlook `.msg` files (Compound File Binary / CFBF). Treat every input as hostile.

## Threat model

An attacker who can supply a `.msg` (or a byte stream that claims to be one) may try to:

- hang the parser with cyclic FAT, DIFAT, MiniFAT, or directory graphs
- exhaust memory with oversized RTF, HTML, encoded-words, or the result object
- write leftover files under the process temp directory
- abort handling incorrectly so temp files or file handles leak
- pollute `Object.prototype` through property or directory names

The library is a parser, not an HTML sanitizer and not a sandbox.

## What is enforced (current defaults)

Defaults live in `src/api/options.ts`, `src/cfb/InputSource.ts`, `src/cfb/readers/directoryReader.ts`, and `src/rtf/decompressRtf.ts`.

| Control | Default | Role |
| --- | --- | --- |
| `maxInputBytes` | 512 MiB | Caps Buffer/file/stream size |
| `streamMemoryThreshold` | 8 MiB | Spills `Readable` input to `os.tmpdir()/msg-js-*` |
| `maxDirectoryDepth` | 128 | Caps CFBF directory nesting |
| `maxDirectoryBytes` | 32 MiB | Caps buffered directory |
| `maxAttachments` | 1000 | Caps attachment storages |
| `maxRecipients` | 1000 | Caps recipient storages |
| `maxResultBytes` | 256 MiB | Caps returned strings/buffers |
| `maxRtfBytes` | 64 MiB | Caps decompressed RTF |
| `maxEmbeddedMessageDepth` | 16 | Caps nested messages |
| `maxAttachmentBytes` | unset | Optional per-file attachment cap |
| `signal` | unset | Cancels reads and removes temp files |

FAT, DIFAT, MiniFAT, and directory walks use visited-set cycle detection and throw `CorruptedSectorChainError` or `InvalidCfbfError`. Compressed RTF checks `rawSize` against `maxRtfBytes` before allocating the output buffer.

Invalid numeric options throw `RangeError` and include the option name (for limits validated at configure/source creation time). Some structural limit failures use `CorruptedSectorChainError` instead (for example directory depth).

Filesystem failures and malformed structures — including a missing attachment content stream — surface as `MsgError` subclasses. The original OS error is preserved in `cause`, but its message (and therefore the filesystem path) is not copied into the thrown message.

## Recommended settings for untrusted input

Tighten defaults in production:

```ts
await parseMsg(input, {
  maxInputBytes: 32 * 1024 * 1024,
  maxResultBytes: 32 * 1024 * 1024,
  maxRtfBytes: 8 * 1024 * 1024,
  maxAttachments: 50,
  maxRecipients: 200,
  maxAttachmentBytes: 8 * 1024 * 1024,
  maxEmbeddedMessageDepth: 4,
  maxDirectoryDepth: 32,
  maxDirectoryBytes: 4 * 1024 * 1024,
  streamMemoryThreshold: 1 * 1024 * 1024,
  signal: AbortSignal.timeout(10_000),
});
```

For untrusted bulk processing, run the parser in a worker process with a heap cap (for example `node --max-old-space-size=128`) so a missed allocation cannot take down the host.

## HTML is not sanitized

`body.html` is the HTML stored in the message (or extracted from encapsulated RTF). This library does **not** sanitize it. Rendering it in a browser or WebView is the consumer's responsibility (DOMPurify, a dedicated HTML sanitizer, or not rendering HTML at all).

## Reporting a vulnerability

Please use [GitHub Security Advisories](https://github.com/atomiccf/outlook-msg-reader/security/advisories/new) on this repository. Do not open a public issue for exploitable bugs.

## Supported versions

Only the latest published `0.x` release on npm is supported with security fixes.
