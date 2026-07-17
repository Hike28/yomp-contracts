// Tests for the community write-path doc-id helpers (B3-0).
// Runs under Node's native test runner + type-stripping: `npm test` → `node --test`.
// Imports the GENERATED TypeScript directly (no build step, no loader dependency) so the
// tests assert the exact symbols consumers import.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  safeId,
  signalDocId,
  reportDocId,
  REPORT_REASONS,
  savedPlaceDocId,
  SAVED_PLACE_KEYS,
} from "../build/ts/constants.ts";

// The saved-place schema is the AUTHORED source of truth for the key allowlist. Read it directly so
// the test asserts SAVED_PLACE_KEYS against the SAME schema the generator derives it from — not a
// hand-mirrored copy that could drift with it.
const savedPlaceSchema = JSON.parse(
  readFileSync(new URL("../src/schemas/saved-place.schema.json", import.meta.url), "utf8"),
);
const SCHEMA_PROPERTY_KEYS = Object.keys(savedPlaceSchema.properties);

// A placeId carrying characters safeId rewrites ('/' and ':'), to prove sanitisation
// happens INSIDE the compound id — not just concatenation of the raw value.
const UID = "aUserUid123";
const DIRTY_PLACE_ID = "places/ChIJ:abc 123";
const CLEAN_PLACE_ID = "ChIJclean-123_ok";

test("safeId rewrites every non [A-Za-z0-9_-] char to _", () => {
  assert.equal(safeId(DIRTY_PLACE_ID), "places_ChIJ_abc_123");
  assert.equal(safeId(CLEAN_PLACE_ID), CLEAN_PLACE_ID); // already safe → unchanged
});

test("signalDocId = `${uid}_${safeId(placeId)}` (safeId applied inside the id)", () => {
  assert.equal(signalDocId(UID, DIRTY_PLACE_ID), `${UID}_${safeId(DIRTY_PLACE_ID)}`);
  assert.equal(signalDocId(UID, DIRTY_PLACE_ID), `${UID}_places_ChIJ_abc_123`);
  // The doc-id suffix must equal safeId(placeId), matching the stored placeId FIELD form.
  assert.equal(signalDocId(UID, DIRTY_PLACE_ID).slice(UID.length + 1), safeId(DIRTY_PLACE_ID));
});

test("signalDocId leaves an already-safe placeId untouched", () => {
  assert.equal(signalDocId(UID, CLEAN_PLACE_ID), `${UID}_${CLEAN_PLACE_ID}`);
});

test("reportDocId = `${uid}_${safeId(placeId)}_${reason}` for every REPORT_REASON", () => {
  for (const reason of REPORT_REASONS) {
    assert.equal(
      reportDocId(UID, DIRTY_PLACE_ID, reason),
      `${UID}_${safeId(DIRTY_PLACE_ID)}_${reason}`,
    );
  }
  assert.equal(reportDocId(UID, DIRTY_PLACE_ID, "closed"), `${UID}_places_ChIJ_abc_123_closed`);
});

test("REPORT_REASONS matches the deployed venue_reports rule set", () => {
  assert.deepEqual([...REPORT_REASONS], ["closed", "no_dogs", "wrong_location", "other"]);
});

// ── saved_places write-model (this brick) ───────────────────────────────────────

test("savedPlaceDocId = `${uid}_${safeId(placeId)}` (safeId applied inside the id)", () => {
  assert.equal(savedPlaceDocId(UID, DIRTY_PLACE_ID), `${UID}_${safeId(DIRTY_PLACE_ID)}`);
  assert.equal(savedPlaceDocId(UID, DIRTY_PLACE_ID), `${UID}_places_ChIJ_abc_123`);
  // The doc-id suffix must equal safeId(placeId), matching the stored placeId FIELD form the
  // deployed rule checks (`saveId == uid + '_' + placeId`).
  assert.equal(savedPlaceDocId(UID, DIRTY_PLACE_ID).slice(UID.length + 1), safeId(DIRTY_PLACE_ID));
});

test("savedPlaceDocId leaves an already-safe placeId untouched", () => {
  assert.equal(savedPlaceDocId(UID, CLEAN_PLACE_ID), `${UID}_${CLEAN_PLACE_ID}`);
});

test("safeId is idempotent — the sanitised placeId round-trips through savedPlaceDocId", () => {
  // safeId(safeId(x)) === safeId(x): re-sanitising the already-stored (safe) placeId is a no-op, so
  // a doc id rebuilt from the stored FIELD equals the doc id built from the raw placeId.
  const stored = safeId(DIRTY_PLACE_ID);
  assert.equal(safeId(stored), stored);
  assert.equal(savedPlaceDocId(UID, stored), savedPlaceDocId(UID, DIRTY_PLACE_ID));
});

test("SAVED_PLACE_KEYS is the schema's full property set — all 9, an allowlist not a required-list", () => {
  // Derived from `properties` (NOT `required`): the 2 optional keys are permitted members.
  assert.deepEqual([...SAVED_PLACE_KEYS], SCHEMA_PROPERTY_KEYS);
  assert.equal(SAVED_PLACE_KEYS.length, 9);
  assert.ok(SAVED_PLACE_KEYS.includes("photoName"), "optional photoName must be a permitted key");
  assert.ok(SAVED_PLACE_KEYS.includes("rating"), "optional rating must be a permitted key");
  // Exact allowlist + order — what a future rules-parity hasOnly() check compares against.
  assert.deepEqual(
    [...SAVED_PLACE_KEYS],
    ["uid", "placeId", "placeName", "placeType", "placeLat", "placeLng", "savedAt", "photoName", "rating"],
  );
  // Proves the derivation is properties-based, not required-based (required omits the 2 optionals).
  assert.notDeepEqual([...SAVED_PLACE_KEYS], savedPlaceSchema.required);
});
