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
scripts/build-gazetteer.mjs   DATA build: OS Open Names → data/ (separate entrypoint)
data/                         COMMITTED derived data — read directly, never codegen'd
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
- **The dog-verdict rule** (`deriveDogVerdict` in `build/ts/constants.ts`;
  `DogVerdict.derive` in `build/kotlin/common/DogVerdict.kt`): the shared community verdict —
  yes/no/check from the directional (yes + no) majority, gated at `MIN_COMMUNITY_VOTES` with an
  explicit `insufficient` state below it; check votes never gate or decide; `HIGH_CONFIDENCE_VOTES`
  sets a confidence label only, never the verdict. This is the repo's first *behavioural* contract:
  the logic is authored once per language as templates in `build.mjs` (§9) with values injected
  from `community.json`, and guarded fail-fast (thresholds + status vocabulary) before any emission.

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

## GB place gazetteer

`data/gb-places.json` — every populated place in Great Britain with WGS84 coordinates,
powering native map town-search. **43,268 entries, 2.81 MiB raw / 596 KiB gzipped.**

```json
[{"name":"Dover","type":"town","lat":51.12814,"lng":1.30843}, …]
```

| `type` | count | | `type` | count |
|---|---:|---|---|---:|
| `city` | 71 | | `hamlet` | 12,900 |
| `town` | 1,353 | | `suburb` | 10,876 |
| `village` | 15,155 | | `settlement` | 2,913 |

These are the complete `LOCAL_TYPE` vocabulary under OS's `TYPE=populatedPlace` — the
include-set is that one structural predicate, not a hand-curated list, so a new OS
settlement class fails the build loudly rather than vanishing. `suburb` (OS "Suburban
Area") is what makes in-city search work at all: users search *Chorlton*, *Jesmond*,
*Didsbury*, none of which are towns. Rank them however you like at query time — the `type`
field keeps them separable.

**This is data, not a contract.** It deliberately does not flow through `scripts/build.mjs`:
no quicktype, no constants emitter, no generated Kotlin object. Hence its own top-level
`data/` directory — neither authored codegen input (`src/`) nor codegen output (`build/`),
but committed derived data that consumers read directly.

**Names are not unique.** 43,268 entries carry only 35,432 distinct names; 3,470 names occur
more than once (`Newtown` ×90, `West End` ×63, `Newton` ×57). These are genuinely distinct
places and all are kept — never dedupe by name. Disambiguate by coordinate/proximity.

Sorted by a total order (`name`, `type`, `lat`, `lng`) using plain codepoint comparison, so
regeneration is byte-identical and diffable on any machine. Coordinates are rounded to 5 dp
(~1 m), which also pins the file against float noise from future `proj4` releases.

### Regenerating

```sh
npm run build:gazetteer
```

Pulls OS Open Names (~98 MiB) from the OS Data Hub Downloads API — no API key needed for
OpenData — verifies the archive against the manifest md5, caches it in `.cache/`
(gitignored, **never committed**), and rewrites `data/gb-places.json`. Delete `.cache/` to
force a fresh pull when OS publishes a new version; the current build is OS product version
**2026-04**. The source ships British National Grid eastings/northings only, so conversion
to WGS84 is mandatory and is done with `proj4` (OSGB36 7-parameter Helmert, ~2–5 m — fine
for settlement centroids, not for anything survey-grade).

Consumers **never run this**. They read the committed JSON via the submodule, exactly as
they read `build/`. Nothing is downloaded at consumer build time.

### Attribution — required

OS Open Names is released under the [Open Government Licence v3](http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
Any app shipping this dataset **must surface this line in its UI** — not merely in a repo
file. Put it wherever map data is credited (`yomp-android`'s map/search screen and
`yomp-next`'s map attribution, alongside the existing map-provider credits):

> Contains OS data © Crown Copyright and database rights 2026.

The product's own licence file also lists Royal Mail and National Statistics
acknowledgements; those attach to the postcode records, which this extract excludes
entirely, so they are not required for the derived dataset. **Update the year** whenever the
gazetteer is regenerated from a newer OS release.

## Build

```sh
npm install
npm run build     # regenerate build/ts + build/kotlin
npm run verify    # tsc --noEmit on the generated TypeScript
npm test          # node --test (contracts + gazetteer integrity)
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

Because `yomp-android` consumes `build/kotlin/common/` as a Gradle source set, the generated Kotlin is
subject to that repo's ktlint line-length rule. The generator therefore wraps the doc comments it
emits from authored schema `description`s (e.g. the per-key semantics in `SavedPlaceKeys.kt`) at 100
columns; keep that cap in mind when changing the emitter.
