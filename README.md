# yomp-contracts

Language-neutral source of truth for Yomp's **Firestore data contracts**. One authored source
generates per-language outputs so the web app (`yomp-next`, TypeScript) and native app
(`yomp-android`, Kotlin/Compose) — which share one Firebase project and dataset — can never drift.

Sibling repo to [`yomp-tokens`](https://github.com/Hike28/yomp-tokens) (design tokens); same
philosophy: **one source → generated outputs → distributed as a git submodule.**

## Layout

```
src/schemas/*.schema.json     authored JSON Schema (draft-07) — document shapes
src/constants/community.json  authored constant values — enums, thresholds, rules
scripts/build.mjs             codegen: quicktype (shapes) + constants emitter
build/ts/                     GENERATED TypeScript (committed)
build/kotlin/common/          GENERATED Kotlin — commonMain-safe (committed)
build/kotlin/android/         GENERATED Kotlin — Firebase/androidMain-bound (committed)
```

`build/` is **committed** — consumers read the generated files via the submodule and never run
codegen themselves.

## What's encoded so far

- **`place_stats`** document shape (`build/ts/place-stats.ts`, `build/kotlin/android/PlaceStats.kt`).
- **Core community constants** (`build/ts/constants.ts`, `build/kotlin/common/Community.kt`):
  `STATUS` (`yes`/`no`/`check`), the six `ATTRIBUTE_KEYS`, `MIN_COMMUNITY_VOTES` (3),
  `HIGH_CONFIDENCE_VOTES` (10), and `safeId()` (the Firestore doc-id sanitiser).

`lastUpdated` is a Firestore server Timestamp — bound to each platform's **native SDK type**, but
the two outputs diverge by design so each matches how that platform actually writes/reads the field:

- **TS** emits it **required** as `lastUpdated: Timestamp | FieldValue | null` via a type-only
  `import type { FieldValue, Timestamp } from "firebase/firestore"` — `Timestamp` on read,
  `FieldValue` for the `serverTimestamp()` write moment, `null` for a cleared/normalised value.
- **Kotlin** keeps nullable `val lastUpdated: Timestamp? = null` (`typealias Timestamp =
com.google.firebase.Timestamp`). `FieldValue` is an SDK write-sentinel with no data-class form, so
  it never appears in the Kotlin shape.

Both map straight to the Firestore SDK's `Timestamp` (zero runtime cost in TS — consumers resolve it
from their own `firebase` install). The shared JSON Schema leaves `lastUpdated` optional (legacy
docs can lack it); the TS-required narrowing lives in `build.mjs`'s post-process, not `required[]`,
precisely so Kotlin can stay nullable. Likewise `attributeCounts` is narrowed to
`Partial<Record<AttributeKey, AttributeCount>>` in TS while Kotlin keeps `Map<String, AttributeCount>?`.

## Build

```sh
npm install
npm run build     # regenerate build/ts + build/kotlin
npm run verify    # tsc --noEmit on the generated TypeScript
```

The Kotlin output is **emitted only** here; it is compiled when `yomp-android`'s `:shared` module
consumes this repo (Kotlin package `dog.yomp.contracts`).

## Consuming as a submodule

```sh
git submodule add https://github.com/Hike28/yomp-contracts vendor/yomp-contracts
```

Web imports from `build/ts/`; native sources `build/kotlin/common/` into `:shared` commonMain and
`build/kotlin/android/` into androidMain (the latter carries the Firebase `Timestamp` typealias).
(Wiring is done in the consuming repos, not here.)
