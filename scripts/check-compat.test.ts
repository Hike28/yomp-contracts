// Tests for the additive-only compatibility diff (scripts/check-compat.mjs).
// Runs under Node's native test runner + type-stripping: `npm test` -> `node --test`.
import test from "node:test";
import assert from "node:assert/strict";

import { applyDeprecations, compareTrees, diffConstants, diffSchema } from "./check-compat.mjs";

const TODAY = "2026-10-08";

// `any`: the cases below mutate this schema freely.
const base = (): any => ({
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    status: { type: "string", enum: ["yes", "no", "unknown"] },
    tags: { type: "array", items: { type: "object", properties: { label: { type: "string" } } } },
  },
});

const rules = (violations: Array<{ rule: string }>) => violations.map((v) => v.rule).sort();

// ── Additions pass ──────────────────────────────────────────────────────────────

test("identical schemas are compatible", () => {
  assert.deepEqual(diffSchema("p.schema.json", base(), base()), []);
});

test("additions pass: new optional property, new enum value, wider type, new nested property", () => {
  const next = base();
  next.properties.extra = { type: "string" };
  next.properties.status.enum.push("maybe");
  next.properties.name.type = ["string", "null"];
  next.properties.tags.items.properties.colour = { type: "string" };
  assert.deepEqual(diffSchema("p.schema.json", base(), next), []);
});

test("a new schema file and new constants keys pass", () => {
  const result = compareTrees(
    { "src/constants/a.json": { keep: [1] } },
    { "src/constants/a.json": { keep: [1], added: "x" }, "src/schemas/new.schema.json": base() },
    [],
    TODAY,
  );
  assert.deepEqual(result.breaking, []);
});

// ── Each BREAKING rule fails ────────────────────────────────────────────────────

test("BREAKING: property removed", () => {
  const next = base();
  delete next.properties.name;
  const v = diffSchema("p.schema.json", base(), next);
  assert.deepEqual(rules(v), ["property-removed"]);
  assert.equal(v[0].name, "p.schema.json#/properties/name");
});

test("BREAKING: nested property removed", () => {
  const next = base();
  delete next.properties.tags.items.properties.label;
  const v = diffSchema("p.schema.json", base(), next);
  assert.deepEqual(rules(v), ["property-removed"]);
  assert.equal(v[0].name, "p.schema.json#/properties/tags/items/properties/label");
});

test("BREAKING: property type changed", () => {
  const next = base();
  next.properties.name.type = "number";
  assert.deepEqual(rules(diffSchema("p.schema.json", base(), next)), ["type-changed"]);
});

test("BREAKING: property type narrowed", () => {
  const wide = base();
  wide.properties.name.type = ["string", "null"];
  const next = base();
  assert.deepEqual(rules(diffSchema("p.schema.json", wide, next)), ["type-changed"]);
});

test("BREAKING: integer to number is not treated as a widening", () => {
  const before = base();
  before.properties.name.type = "integer";
  const next = base();
  next.properties.name.type = "number";
  assert.deepEqual(rules(diffSchema("p.schema.json", before, next)), ["type-changed"]);
});

test("BREAKING: enum value removed", () => {
  const next = base();
  next.properties.status.enum = ["yes", "no"];
  const v = diffSchema("p.schema.json", base(), next);
  assert.deepEqual(rules(v), ["enum-value-removed"]);
  assert.equal(v[0].name, "p.schema.json#/properties/status/enum/unknown");
});

test("BREAKING: property newly added to required", () => {
  const next = base();
  next.required.push("name");
  assert.deepEqual(rules(diffSchema("p.schema.json", base(), next)), ["required-added"]);
});

test("BREAKING: a brand new property that is also required", () => {
  const next = base();
  next.properties.fresh = { type: "string" };
  next.required.push("fresh");
  assert.deepEqual(rules(diffSchema("p.schema.json", base(), next)), ["required-added"]);
});

test("BREAKING: additionalProperties true or absent -> false", () => {
  const closed = base();
  closed.additionalProperties = false;
  assert.deepEqual(rules(diffSchema("p.schema.json", base(), closed)), ["additional-properties-closed"]);
  const open = base();
  open.additionalProperties = true;
  assert.deepEqual(rules(diffSchema("p.schema.json", open, closed)), ["additional-properties-closed"]);
});

test("additionalProperties already false stays compatible", () => {
  const a = base();
  a.additionalProperties = false;
  assert.deepEqual(diffSchema("p.schema.json", a, a), []);
});

test("BREAKING: schema file removed", () => {
  const result = compareTrees({ "src/schemas/p.schema.json": base() }, {}, [], TODAY);
  assert.deepEqual(rules(result.breaking), ["file-removed"]);
});

test("BREAKING: constants key path removed", () => {
  const before = { thresholds: { MIN: 3, HIGH: 10 }, status: ["yes"] };
  const after = { thresholds: { MIN: 3 }, status: ["yes"] };
  const v = diffConstants("community.json", before, after);
  assert.deepEqual(rules(v), ["constant-removed"]);
  assert.equal(v[0].name, "community.json#thresholds.HIGH");
});

test("BREAKING: constants array string member removed; reordering and changed values pass", () => {
  const before = { status: ["yes", "no", "check"], thresholds: { MIN: 3 } };
  assert.deepEqual(rules(diffConstants("community.json", before, { status: ["yes", "no"], thresholds: { MIN: 3 } })), [
    "constant-member-removed",
  ]);
  assert.deepEqual(diffConstants("community.json", before, { status: ["check", "no", "yes", "new"], thresholds: { MIN: 5 } }), []);
});

// ── Deprecation window ──────────────────────────────────────────────────────────

const removedName = { name: "p.schema.json#/properties/name", deprecatedIn: "v1.1.0", removeAfter: "2026-09-01" };

test("a removal listed in deprecations.json with removeAfter in the past is allowed", () => {
  const next = base();
  delete next.properties.name;
  const result = compareTrees(
    { "src/schemas/p.schema.json": base() },
    { "src/schemas/p.schema.json": next },
    [removedName],
    TODAY,
  );
  assert.deepEqual(result.breaking, []);
  assert.equal(result.allowed.length, 1);
});

test("removeAfter equal to today is allowed", () => {
  const next = base();
  delete next.properties.name;
  const result = compareTrees(
    { "src/schemas/p.schema.json": base() },
    { "src/schemas/p.schema.json": next },
    [{ ...removedName, removeAfter: TODAY }],
    TODAY,
  );
  assert.deepEqual(result.breaking, []);
});

test("a removal inside its deprecation window (removeAfter in the future) is still BREAKING", () => {
  const next = base();
  delete next.properties.name;
  const result = compareTrees(
    { "src/schemas/p.schema.json": base() },
    { "src/schemas/p.schema.json": next },
    [{ ...removedName, removeAfter: "2026-12-31" }],
    TODAY,
  );
  assert.deepEqual(rules(result.breaking), ["property-removed"]);
  assert.match(result.breaking[0].message, /removeAfter 2026-12-31/);
});

test("a deprecation entry for a different name does not cover the removal", () => {
  const next = base();
  delete next.properties.name;
  const result = compareTrees(
    { "src/schemas/p.schema.json": base() },
    { "src/schemas/p.schema.json": next },
    [{ ...removedName, name: "p.schema.json#/properties/other" }],
    TODAY,
  );
  assert.deepEqual(rules(result.breaking), ["property-removed"]);
});

test("deprecation can never excuse a type narrowing, new required field or closed additionalProperties", () => {
  const next = base();
  next.properties.name.type = "number";
  next.required.push("name");
  next.additionalProperties = false;
  const found = diffSchema("p.schema.json", base(), next);
  const entries = found.map((v) => ({ name: v.name, deprecatedIn: "v1.1.0", removeAfter: "2000-01-01" }));
  const result = applyDeprecations(found, entries, TODAY);
  assert.equal(result.breaking.length, 3);
  assert.deepEqual(result.allowed, []);
});

test("an enum value and a constants key removal can be covered by a matured deprecation", () => {
  const next = base();
  next.properties.status.enum = ["yes", "no"];
  const found = [
    ...diffSchema("p.schema.json", base(), next),
    ...diffConstants("community.json", { a: { b: 1 } }, { a: {} }),
  ];
  const entries = [
    { name: "p.schema.json#/properties/status/enum/unknown", deprecatedIn: "v1.1.0", removeAfter: "2026-01-01" },
    { name: "community.json#a.b", deprecatedIn: "v1.1.0", removeAfter: "2026-01-01" },
  ];
  const result = applyDeprecations(found, entries, TODAY);
  assert.deepEqual(result.breaking, []);
  assert.equal(result.allowed.length, 2);
});
