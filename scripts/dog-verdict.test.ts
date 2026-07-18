// Tests for the shared community dog-verdict rule (I-2-0).
// Runs under Node's native test runner + type-stripping: `npm test` → `node --test`.
// Imports the GENERATED TypeScript directly (no build step, no loader dependency) so the
// tests assert the exact symbols consumers import.
import test from "node:test";
import assert from "node:assert/strict";

import { deriveDogVerdict, HIGH_CONFIDENCE_VOTES, MIN_COMMUNITY_VOTES } from "../build/ts/constants.ts";

test("the thresholds under test are the contract values (3 / 10)", () => {
  assert.equal(MIN_COMMUNITY_VOTES, 3);
  assert.equal(HIGH_CONFIDENCE_VOTES, 10);
});

// ── The directional gate ────────────────────────────────────────────────────────

test("below the directional gate → insufficient, confidence null", () => {
  assert.deepEqual(deriveDogVerdict(0, 0, 0), { status: "insufficient", confidence: null, totalVotes: 0 });
  assert.deepEqual(deriveDogVerdict(1, 0, 0), { status: "insufficient", confidence: null, totalVotes: 1 });
});

test("check votes never fill the gate: 1y + 2c is still insufficient", () => {
  // Three votes exist, but only ONE is directional — the gate must not open.
  assert.deepEqual(deriveDogVerdict(1, 0, 2), { status: "insufficient", confidence: null, totalVotes: 1 });
});

test("an all-check pile yields no verdict: 10 check votes alone are insufficient", () => {
  assert.deepEqual(deriveDogVerdict(0, 0, 10), { status: "insufficient", confidence: null, totalVotes: 0 });
});

test("gate boundary: 2 directional votes insufficient, 3 yield a verdict", () => {
  assert.equal(deriveDogVerdict(2, 0, 0).status, "insufficient");
  assert.deepEqual(deriveDogVerdict(3, 0, 0), { status: "yes", confidence: "medium", totalVotes: 3 });
});

// ── The directional verdict ─────────────────────────────────────────────────────

test("directional majority at the gate: 2y+1n → yes; 1y+2n → no", () => {
  assert.deepEqual(deriveDogVerdict(2, 1, 0), { status: "yes", confidence: "medium", totalVotes: 3 });
  assert.deepEqual(deriveDogVerdict(1, 2, 0), { status: "no", confidence: "medium", totalVotes: 3 });
});

test("directional tie above the gate → check (community disagrees)", () => {
  assert.deepEqual(deriveDogVerdict(2, 2, 0), { status: "check", confidence: "medium", totalVotes: 4 });
});

// ── Confidence — a label only ───────────────────────────────────────────────────

test("confidence boundary: 9 directional votes medium, 10 high — verdict unchanged", () => {
  assert.deepEqual(deriveDogVerdict(5, 4, 0), { status: "yes", confidence: "medium", totalVotes: 9 });
  assert.deepEqual(deriveDogVerdict(6, 4, 0), { status: "yes", confidence: "high", totalVotes: 10 });
});

// ── checkCount inertness ────────────────────────────────────────────────────────

test("checkCount is inert everywhere: verdict, confidence and totalVotes all ignore it", () => {
  // totalVotes is the DIRECTIONAL sum (yes + no) — 50 check votes change nothing.
  assert.deepEqual(deriveDogVerdict(2, 1, 50), { status: "yes", confidence: "medium", totalVotes: 3 });
  assert.deepEqual(deriveDogVerdict(2, 1, 50), deriveDogVerdict(2, 1, 0));
});

// ── Negative control ────────────────────────────────────────────────────────────

test("NEGATIVE CONTROL — the one-vote flip is abolished: a single yes is NOT a 'yes' verdict", () => {
  // Web's legacy deriveDogStatus (yomp-next src/lib/placeStats.ts) returns 'yes' here;
  // the shared contract must never emit a confident verdict below the directional gate.
  assert.notEqual(deriveDogVerdict(1, 0, 0).status, "yes");
});
