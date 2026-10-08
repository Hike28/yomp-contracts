# yomp-contracts

Language-neutral source of truth for Yomp's **data contracts**. One authored source generates
per-language outputs (TypeScript and Kotlin) so the API and the native app can never drift.

Sibling repo to [`yomp-tokens`](https://github.com/Hike28/yomp-tokens) (design tokens); same
philosophy: **one source → generated outputs → pinned by consumers.**

## Who consumes this

| Consumer | How it consumes | What it reads |
|---|---|---|
| `yomp-android` | git submodule at `vendor/yomp-contracts`, pinned to a commit or tag | `build/kotlin/` (compiled into `:shared`), `data/gb-places.json`, and `fixtures/places-response.json` (read by a unit test) |
| `yomp-api` | **plain vendored copy** of `build/ts/constants.ts`, `build/ts/place-stats.ts`, `build/ts/place.ts`, `src/schemas/place.schema.json` and `fixtures/places-response.json`, pinned by a pin file in that repo (not a submodule) | response types from `build/ts/place.ts`; its tests validate the route output against the schema and the fixture |
| `yomp-web` | does not consume this repo; it takes design tokens only, from `yomp-tokens` | nothing |

`yomp-next`, the old web app that this README used to name as the consumer, is retired.

Consumers pin an **exact tag or commit** and update on purpose. They never track a branch, and
they never run codegen themselves.

## Layout

```
src/schemas/*.schema.json     authored JSON Schema (draft-07) — document and response shapes
src/constants/*.json          authored constant values — enums, thresholds, limits, rules
scripts/build.mjs             codegen: quicktype (shapes) + constants emitter
scripts/build-gazetteer.mjs   DATA build: OS Open Names → data/ (separate entrypoint, network)
scripts/check-compat.mjs      two-tier compatibility check against the previous release tag
scripts/*.test.ts             node:test suites (contracts, gazetteer integrity, compat diff)
deprecations.json             deprecation register read by the compat check (from the baseline tag)
compat-acknowledgements.json  accepted RISKY changes for the version being released (working tree)
data/gb-places.json           COMMITTED derived data — read directly, never codegen'd
fixtures/places-response.json COMMITTED sample of a GET /api/places body, emitted by yomp-api's own
                              route handler with upstreams mocked (synthetic venues, no credentials);
                              validated against place.schema.json here and in yomp-api, read by Android
build/ts/                     GENERATED TypeScript (committed)
build/kotlin/common/          GENERATED Kotlin — commonMain-safe (committed)
build/kotlin/android/         GENERATED Kotlin — Firebase/androidMain-bound (committed)
docs/                         design notes
.github/workflows/ci.yml      CI
```

`build/` is **committed** — consumers read the generated files and never run codegen themselves.

### The places fixture

`fixtures/places-response.json` is not hand-written. It is the body yomp-api's own `GET /api/places`
handler emits for four synthetic venues (every upstream mocked, no network, no spend). To regenerate
it, run yomp-api's `tests/unit/places.contract-fixture.test.ts` with `WS7_FIXTURE_OUT` set to the
output path, then copy the file here and bump the pins in the consumers. Treat a change to it like a
change to the schema: the compatibility rule below applies, because Android builds 1004-1007 parse
this shape.

### What `npm run build` produces

Schemas (`src/schemas/`): `place`, `place-stats`, `saved-place`, `user-record`.
Constants (`src/constants/`): `community`, `map`, `account`, `saved-places`.

| Output | Source |
|---|---|
| `build/ts/place.ts`, `build/kotlin/common/Place.kt` | `place.schema.json` |
| `build/ts/place-stats.ts`, `build/kotlin/android/PlaceStats.kt` | `place-stats.schema.json` |
| `build/ts/user-record.ts`, `build/kotlin/android/UserRecord.kt` | `user-record.schema.json` |
| `build/ts/constants.ts` (all constants, doc-id helpers, `deriveDogVerdict`) | `community`, `map`, `account`, `saved-places` constants plus key lists derived from `user-record` and `saved-place` schemas |
| `build/kotlin/common/Community.kt`, `DogVerdict.kt`, `Map.kt`, `Account.kt`, `SavedPlaces.kt` | the same constants |
| `build/kotlin/common/UserKeys.kt`, `SavedPlaceKeys.kt` | property names of the `user-record` and `saved-place` schemas |

`data/gb-places.json` is **not** a build output; see "GB place gazetteer" below.
`src/constants/Roles.kt` and `roles.ts` are authored files that the build does not read.

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

Consumers **never run this**. They read the committed JSON through their pinned checkout,
exactly as they read `build/`. Nothing is downloaded at consumer build time. CI never runs it
either (it needs the network).

### Gazetteer location

`data/gb-places.json` is the **single declared location** of the gazetteer. It lives inside this
repo and is consumed through the pinned checkout. Any script that reads it must:

- take the path from the `YOMP_GAZETTEER` environment variable (`process.env.YOMP_GAZETTEER`, the
  exact name the yomp-api seo-hubs scripts already use), or from an optional `--gazetteer <path>`
  argument, with **no hard-coded machine path**;
- when the path is unset or the file is missing, exit non-zero with a message that names the
  variable and says how to set it, for example
  `Set YOMP_GAZETTEER to the checked-out data/gb-places.json (PowerShell: $env:YOMP_GAZETTEER = "<repo>\data\gb-places.json").`

Inside this repo the tests resolve the file relative to the repo root, which is also compliant.

### Attribution — required

OS Open Names is released under the [Open Government Licence v3](http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
Any app shipping this dataset **must surface this line in its UI** — not merely in a repo
file. Put it wherever map data is credited (`yomp-android`'s map/search screen and
any web map attribution, alongside the existing map-provider credits):

> Contains OS data © Crown Copyright and database rights 2026.

The product's own licence file also lists Royal Mail and National Statistics
acknowledgements; those attach to the postcode records, which this extract excludes
entirely, so they are not required for the derived dataset. **Update the year** whenever the
gazetteer is regenerated from a newer OS release.

## Build

```sh
npm ci
npm run build          # regenerate build/ts + build/kotlin
npm run verify         # tsc --noEmit on the generated TypeScript
npm test               # node --test (contracts, gazetteer integrity, compat diff)
npm run check:compat   # two-tier compatibility check against the previous release tag
npm run build:gazetteer  # network; regenerates data/gb-places.json; never run in CI
```

The Kotlin output is **emitted only** here; it is compiled when `yomp-android`'s `:shared` module
consumes this repo (Kotlin package `dog.yomp.contracts`).

## CI and releases

`.github/workflows/ci.yml` runs on every push to `main` and every pull request: `npm ci`,
`npm run build`, a **generated-files-up-to-date** check (fails if the build leaves any tracked
change or untracked file, so edit the source and commit the rebuilt `build/`), `npm run verify`,
`npm test`, and `npm run check:compat`. It checks out full history and tags because the compat
check needs them.

Line endings are pinned to LF by `.gitattributes`, so generated files compare byte for byte on
every platform.

A release is an annotated git tag `vMAJOR.MINOR.PATCH` on `main`, matching `version` in
`package.json`, with an entry in `CHANGELOG.md`. The compat check uses as its baseline the latest
tag reachable from HEAD **excluding every tag that points at HEAD** (`git tag --points-at HEAD`,
each passed to `git describe --tags --abbrev=0` as `--exclude`), so a tagged release is compared
with the release before it, never with itself. It prints which tag it used and which it excluded.
When HEAD is untagged, that is simply the latest tag. With no baseline tag it exits 2
(`NO BASELINE TAG: compat check did not run`) rather than passing.

Release procedure:

1. Merge to `main` **fast-forward or with a merge commit. Never squash and never rebase.** The tagged
   commit, and the pins other repos hold (`yomp-android`'s submodule commit, `yomp-api`'s pin
   file), must stay reachable from `main`; a squash or rebase rewrites them away.
2. **Push the tags before opening or merging a PR.** The compat step needs the baseline tag on the
   remote, and CI fetches full history and tags.
3. Record any accepted RISKY change in `compat-acknowledgements.json` (see below) in the same
   release.

## Compatibility rule

Compatibility is judged for the **readers**: the hand-written Android `PlaceDto` readers (builds
1004-1007) and yomp-api's vendored types. A reader breaks when a response gets stricter, and also
when it gets **looser**: a type widened so a string appears where a `Double` is parsed makes
kotlinx throw for the whole array, and a field dropped from `required` may now be missing. So the
check has two tiers. Pure additions stay compatible: a new optional property, a new enum member, a
new constants key or array member, a new schema file.

### HARD (exit 1)

Only a **removal** can be excused, by a matured deprecation (below). Never by an acknowledgement.

- a schema file removed; a property or definition removed (a rename is a removal plus an addition);
- a `type` narrowed or lost;
- an enum value removed;
- a property newly added to `required`;
- `additionalProperties` changed from true or absent to `false`;
- a constants key path removed;
- a constants array member removed, of any JSON type (compared by JSON text).

### RISKY (exit 1 unless acknowledged)

- a `type` widened or changed in any other way (including `integer` to `number`, and a type
  replaced by a `$ref`);
- an entry removed from `required`;
- `items` changed in type or shape (including tuple-form `items`);
- `enum`, `const`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `exclusiveMinimum`,
  `exclusiveMaximum`, `multipleOf` or `format` added where the baseline lacked it, or its value
  changed (the check also covers `minItems`, `maxItems`, `uniqueItems`, `minProperties`,
  `maxProperties`, and a keyword dropped);
- a `$ref` retargeted;
- `oneOf`, `anyOf`, `allOf` or `not` changed (compared by canonical JSON);
- `title` or `$id` changed (`title` names the generated Kotlin class);
- an `additionalProperties` sub-schema changed (or opened from `false`);
- any constants scalar value changed (for example a radius of 50 becoming 5, or a renamed string).

### Acknowledging a RISKY change

A RISKY finding is accepted only by an entry in `compat-acknowledgements.json` **in the working
tree** (it ships as `[]`):

```json
{ "name": "place.schema.json#/properties/photoNames/items/type", "acknowledgedIn": "1.2.0", "reason": "Android 1008 parses either; readers on 1004-1007 verified." }
```

`name` uses the same scheme as deprecation names (`<file>#<pointer or key path>`; the check prints
the exact name for every finding, with its tier and rule). `acknowledgedIn` must equal `version` in
the working tree's `package.json`, and `reason` must be non-empty. An entry for another version,
with an empty reason, or matching no finding is not accepted; entries that match nothing are printed
as a NOTICE so stale ones get cleaned out. Acknowledge only after checking every reader.

### Deprecation window for a HARD removal

A breaking removal needs a **deprecation window**:

1. In the release that deprecates it, add an entry to `deprecations.json`:
   `{ "name": "place.schema.json#/properties/foo", "deprecatedIn": "v1.2.0", "removeAfter": "2026-12-01" }`.
   `name` is the schema or constants file name, `#`, then the JSON pointer (schemas) or dotted key
   path (constants; an array member is `key[member]`; an enum value is `.../enum/<value>`).
2. `removeAfter` must be at least **30 days** after the date of the release that deprecates it.
3. Remove it in a **later** release, on or after `removeAfter`. `check:compat` reads
   `deprecations.json` from the baseline tag, so the entry must already be in a published tag.

The check enforces 3 (and that the entry matches). The 30-day minimum in 2 is a review rule.
Type narrowing, new required fields and closing `additionalProperties` cannot be deprecated away;
they need a new contract (a new schema or a major version agreed with every consumer).

Android builds 1004-1007 are in the field and must keep parsing every response shape, so any
change to the `/api/places` shape (`place.schema.json`) follows these rules exactly.

## Consuming

**`yomp-android`** (submodule):

```sh
git submodule add https://github.com/Hike28/yomp-contracts vendor/yomp-contracts
git -C vendor/yomp-contracts checkout v1.1.0   # pin an exact tag or commit
```

Native sources `build/kotlin/common/` into `:shared` commonMain and `build/kotlin/android/` into
androidMain (the latter carries the Firebase `Timestamp` reference). Gazetteer and fixtures are read from
the same pinned checkout.

**`yomp-api`** (vendored copy): copy `build/ts/constants.ts`, `build/ts/place-stats.ts`,
`build/ts/place.ts`, `src/schemas/place.schema.json` and `fixtures/places-response.json` at a chosen
tag (the five files in the consumer table above), and record that tag or commit in the repo's pin
file. Update by copying again from a newer tag on purpose.

Wiring is done in the consuming repos, not here.

Because `yomp-android` consumes `build/kotlin/common/` as a Gradle source set, the generated Kotlin is
subject to that repo's ktlint line-length rule. The generator therefore wraps the doc comments it
emits from authored schema `description`s (e.g. the per-key semantics in `SavedPlaceKeys.kt`) at 100
columns; keep that cap in mind when changing the emitter.
