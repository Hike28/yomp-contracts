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
build/kotlin/                 GENERATED Kotlin    (committed)
```

`build/` is **committed** — consumers read the generated files via the submodule and never run
codegen themselves.

## What's encoded so far

- **`place_stats`** document shape (`build/ts/place-stats.ts`, `build/kotlin/PlaceStats.kt`).
- **Core community constants** (`build/ts/constants.ts`, `build/kotlin/Community.kt`):
  `STATUS` (`yes`/`no`/`check`), the six `ATTRIBUTE_KEYS`, `MIN_COMMUNITY_VOTES` (3),
  `HIGH_CONFIDENCE_VOTES` (10), and `safeId()` (the Firestore doc-id sanitiser).

`lastUpdated` is a Firestore server Timestamp — bound to each platform's **native SDK type**:
TS uses a type-only `import type { Timestamp } from "firebase/firestore"`, Kotlin uses
`typealias Timestamp = com.google.firebase.Timestamp`. Both sides therefore map straight to the
Firestore SDK's `Timestamp` (zero runtime cost in TS — consumers resolve it from their own
`firebase` install).

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

Web imports from `build/ts/`; native sources `build/kotlin/` into `:shared`. (Wiring is done in the
consuming repos, not here.)
