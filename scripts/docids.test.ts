// Tests for the community write-path doc-id helpers (B3-0).
// Runs under Node's native test runner + type-stripping: `npm test` → `node --test`.
// Imports the GENERATED TypeScript directly (no build step, no loader dependency) so the
// tests assert the exact symbols consumers import.
import test from "node:test";
import assert from "node:assert/strict";

import {
  safeId,
  signalDocId,
  reportDocId,
  REPORT_REASONS,
} from "../build/ts/constants.ts";

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
