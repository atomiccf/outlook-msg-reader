# Fuzzing outlook-msg-reader

Harness: `parse.fuzz.ts` (`fuzz(data: Buffer)`). Inputs larger than 1 MiB are ignored. Only `MsgError` and `RangeError` are treated as expected; any other throw (including `TypeError`) is a finding. This is intentional.

Jazzer.js does not load TypeScript directly here. The `fuzz` script builds the harness with tsup into `fuzz/dist/` and runs the compiled CommonJS file.

## Commands

```bash
npm run fuzz:seed
npm run fuzz -- -max_total_time=60
```

libFuzzer flags must be passed after `--` so they reach the engine rather than npm. The `fuzz` script already appends `-artifact_prefix=fuzz/artifacts/` after `--`, so crashes and hangs are written under `fuzz/artifacts/` (gitignored).

Optional dictionary:

```bash
npm run fuzz -- -dict=fuzz/dict.txt -max_total_time=60
```

Corpus lives in `fuzz/corpus/` (gitignored).

CI runs a 30-minute job from `.github/workflows/security.yml` on a schedule. `fuzz:seed` runs before `npm run fuzz` and creates `fuzz/artifacts/` if it is missing.
