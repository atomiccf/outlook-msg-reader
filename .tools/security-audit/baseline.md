# Security audit baseline

Recorded 2026-11-24 after `npm ci` on a clean install.

## Tooling

- Node: v24.21.0
- npm: 11.19.0
- Package: outlook-msg-reader@0.2.0
- Test runner: vitest 4.1.12 (`npm test` = `vitest run`)

## Checks

Recorded 2026-11-24, re-verified after the security test suite landed.

| Command | Result | Notes |
| --- | --- | --- |
| `npm run lint` | pass | eslint `. --ext .ts` |
| `npm run typecheck` | pass | `tsc --noEmit` |
| `npm test` | pass | 41 files, 355 tests, 7.35s (includes tests/security) |
| `npm run test:security` | pass | 10 consecutive runs, 0 flakes |
| `npm run build` | pass | tsup ESM+CJS+DTS |

`npm ci` reported 9 vulnerabilities (3 moderate, 6 high) in the install audit; details belong in `supply-chain.md` (T2). Runtime `dependencies` remain empty.

## `.gitignore` paths that affect fixtures and audit artifacts

```
node_modules
dist
scripts/
.idea
.tools
!.tools/security-audit/
.tools/security-audit/*
!.tools/security-audit/baseline.md
!.tools/security-audit/supply-chain.md
**/bin
**/obj
tests/fixtures/*
!tests/fixtures/valid/
tests/fixtures/valid/*
!tests/fixtures/valid/outlook/
tests/fixtures/valid/outlook/*
!tests/fixtures/valid/outlook/*.msg
!tests/fixtures/valid/outlook/manifest.json
sample
index.js
run.js
```

Implications:

- Binary MSG fixtures under `tests/fixtures/valid/outlook/*.msg` and `manifest.json` are tracked.
- Other fixture paths (including `tests/fixtures/sent2.msg`) are ignored and must not be added unless a new `!` exception is introduced.
- `.tools/security-audit/findings.md` stays untracked.
- `dist/` is ignored locally; the published tarball still includes built `dist/` via `package.json` `files`.
