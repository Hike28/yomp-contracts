# Changelog

Versions are git tags (`vMAJOR.MINOR.PATCH`). Changes are additive unless a deprecation window
says otherwise; see "Compatibility rule" in the README.

## 1.1.0

Tooling and documentation only. No schema, constant or generated-file changes.

- CI (`.github/workflows/ci.yml`): build, generated-files-up-to-date check, `verify`, `test`,
  `check:compat`.
- `npm run check:compat` (`scripts/check-compat.mjs`): additive-only check against the latest
  release tag, with `deprecations.json` (empty) for deprecation windows.
- `.gitattributes` pins LF line endings so generated files are byte-identical on every platform.
- README rewritten: real consumers (`yomp-android` submodule, `yomp-api` vendored copy), what the
  build emits, scripts, CI and release tags, the compatibility rule and the gazetteer location rule.

## 1.0.0

Baseline (recorded retroactively; the state `yomp-android` pins).

- Schemas: `place`, `place-stats`, `saved-place`, `user-record`.
- Constants: `community`, `map`, `account`, `saved-places`.
- Generated TypeScript in `build/ts` and Kotlin in `build/kotlin/common` and `build/kotlin/android`.
- Shared dog-verdict rule (`deriveDogVerdict`, `DogVerdict.derive`) and doc-id helpers.
- `data/gb-places.json`: GB place gazetteer (OS Open Names, product version 2026-04).
