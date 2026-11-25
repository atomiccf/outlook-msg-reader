# Supply-chain audit

Recorded 2026-11-24. Dependencies were not updated.

## Runtime (`npm audit --omit=dev`)

- Result: **0 vulnerabilities**
- `package.json` has no `dependencies`. Published code is `dist/**` only plus metadata.

## Full tree (`npm audit`)

9 issues, all in **devDependencies** (3 moderate, 6 high). `npm` reports they are fixable with `npm audit fix`. Not applied.

| Package | Severity | Installed via | Advisory / issue | Fix path (not applied) |
| --- | --- | --- | --- | --- |
| brace-expansion | high | eslint/typescript-eslint, glob | brace expansion DoS / hang (several GHSA) | `npm audit fix` (dev) |
| glob | high | eslint/tooling | CLI command injection; AbortSignal bypass | `npm audit fix` (dev) |
| js-yaml | high | eslint | quadratic merge-key / omap DoS | `npm audit fix` (dev) |
| minimatch | high | eslint/glob | ReDoS / globparts amplification | `npm audit fix` (dev) |
| picomatch | high | tooling | method injection / ReDoS | `npm audit fix` (dev) |
| rollup | high | tsup | arbitrary file write (path traversal) 4.0.0–4.58.0 | bump tsup/rollup |
| @humanfs/node | moderate | typescript-eslint | symlink copy outside source | `npm audit fix` (dev) |
| ajv | moderate | eslint | ReDoS with `$data` | `npm audit fix` (dev) |
| fflate | moderate | tooling | unzipSync infinite loop ZIP64 | `npm audit fix` (dev) |

These do not ship in the npm package (no runtime deps). Risk is CI/dev machine only: lint, typecheck, test, build.

## OSV

`osv-scanner` is not installed on this Windows PATH. T14 CI should run an OSV GitHub Action.

## `npm pack --dry-run`

Tarball `outlook-msg-reader-0.2.0.tgz` (7 files):

- `LICENSE`
- `README.md`
- `package.json`
- `dist/index.d.mts`
- `dist/index.d.ts`
- `dist/index.js`
- `dist/index.mjs`

`package.json` `files` is `["dist", "README.md"]`. npm always adds `package.json` and includes `LICENSE` when present. No `src/`, tests, fixtures, or `.tools`. Acceptable for publish; not a leak of parser internals beyond the built bundle.

## Conclusions

- Production audit is clean.
- High issues are toolchain-only; remediate later by `npm audit fix` / bumping eslint, tsup, typescript-eslint — not in this security-test workstream.
- Pack contents match the intended public surface plus LICENSE/package.json.
