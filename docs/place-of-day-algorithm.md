# Place of the Day — selection algorithm

Shared reference for the "Place of the Day" (POD) picker used on the discover
surface. This documents the _algorithm_, not a data contract — no document
crosses a wire boundary here, so there is no JSON Schema entry for it. It
exists so other platforms (e.g. a future iOS build) can port the exact
selection recipe from the canonical implementation
(`yomp-next/src/lib/placeOfDay.ts`) instead of re-deriving it and risking
drift.

**Selection is location+date keyed, not per-user — no rotation, despite what
older comments elsewhere may claim.**

## `dayKey`

The current UTC calendar date, formatted `YYYY-MM-DD`:

```
dayKey(date) = ISO8601(date).slice(0, 10)
```

Rolls over at UTC midnight, not local midnight.

## Hash — djb2

A djb2 variant, seed `5381`, folded to an unsigned 32-bit integer:

```
hash(input):
  h = 5381
  for each character c in input:
    h = ((h << 5) + h + charCode(c)) mod 2^32   // unsigned 32-bit
  return h
```

## `geohash6`

A standard base32 geohash of the query location (`lat`, `lng`), truncated to
**precision 6** (first 6 characters):

```
geohash6 = standardGeohash(lat, lng).slice(0, 6)
```

## Selection

Combine `dayKey` and `geohash6` into one key, hash it, and use the result as
a modulo index into the eligible pool:

```
key   = dayKey(date) + "::" + geohash6
index = hash(key) mod pool.length
place = pool[index]
```

The key deliberately excludes any user identifier and any category
preference — the same date + the same location always yields the same pick,
regardless of who is asking.

## Filter pipeline

Filters are applied to the candidate pool **in this exact order**. Each step
takes the previous step's output as input.

1. **Eligibility** — hard filter. Drop places that:

   - are marked not dog-friendly,
   - fall in the `trails` category,
   - have no photos,
   - are a utility/medical place type (vets, hospitals, banks, garages,
     etc. — not dog-friendly leisure venues).

2. **Rating** — soft, staged relaxation:

   - Keep only places with rating ≥ 4.0.
   - If fewer than 3 places remain, relax to rating ≥ 3.5.
   - If still fewer than 3 places remain, drop the rating filter entirely
     (pass the input pool through unfiltered).

3. **Open-now** — soft filter, keep-unknown:

   - Drop only places explicitly known to be closed right now.
   - Places with no open/closed data available are kept (never penalise
     missing data).
   - If this filter would empty the pool, revert to the pool from before
     this step.

4. **Exclude-seen** — soft filter, keep-unknown:
   - Drop places the caller has already been shown.
   - If this filter would empty the pool, revert to the pool from before
     this step (previously-seen places are re-allowed so a pick is always
     returned).

## Implementation reference

Canonical implementation: `yomp-next/src/lib/placeOfDay.ts`
(`hashString`, `dayKey`, `pickPlaceOfDay`, `choose`).
