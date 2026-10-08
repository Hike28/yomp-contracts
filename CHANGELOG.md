# Changelog

Versions are git tags (`vMAJOR.MINOR.PATCH`). Changes are additive unless a deprecation window
says otherwise; see "Compatibility rule" in the README.

## 1.1.0

Tooling and documentation only. No schema, constant or generated-file changes.

- CI (`.github/workflows/ci.yml`): build, generated-files-up-to-date check, `verify`, `test`,
  `check:compat`.
- `npm run check:compat` (`scripts/check-compat.mjs`): compatibility check against the previous
  release tag, with `deprecations.json` (empty) for deprecation windows.
  - Two tiers, judged for readers: HARD findings (removals, narrowing, new `required`, closed
    `additionalProperties`) always fail; RISKY findings (widening, loosening, retargeted `$ref`,
    changed constants values and the like) fail unless accepted in `compat-acknowledgements.json`
    for the package version, with a reason.
  - The baseline excludes the commit's own tag, so a tagged release is compared with the release
    before it rather than with itself.
  - Hardened: a schema node replaced by `true`, `false` or another non-object is HARD type-lost;
    an acknowledgement is refused while the `package.json` version equals the baseline tag version;
    `removeAfter` must be a real `YYYY-MM-DD` date (invalid entries fail the check); removing a
    property that was in `required` is HARD and cannot be deprecated away (make it optional first).
  - Scope: compatibility is judged on `src/schemas` and `src/constants` only. A `scripts/build.mjs`
    change that alters generated names or types without a schema edit is not covered (known limit),
    nor is reordering a constants array; deprecation names are matched literally.
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
