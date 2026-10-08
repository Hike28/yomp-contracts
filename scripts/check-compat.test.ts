// Tests for the two-tier compatibility diff (scripts/check-compat.mjs).
// Runs under Node's native test runner + type-stripping: `npm test` -> `node --test`.
import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAcknowledgements,
  applyDeprecations,
  chooseBaseline,
  compareTrees,
  diffConstants,
  diffSchema,
} from "./check-compat.mjs";

const TODAY = "2026-10-08";
const F = "p.schema.json";

// `any`: the cases below mutate this schema freely.
const base = (): any => ({
  $id: "https://example.test/p.schema.json",
  title: "P",
  type: "object",
  required: ["id", "name"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    count: { type: "integer" },
    status: { type: "string", enum: ["yes", "no", "unknown"] },
    photos: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "object", properties: { label: { type: "string" } } } },
    owner: { $ref: "#/definitions/Owner" },
  },
  definitions: { Owner: { type: "object", properties: { uid: { type: "string" } } } },
});

const rules = (found: Array<{ rule: string }>) => found.map((v) => v.rule).sort();
const only = (found: Array<{ rule: string; tier: string; name: string }>, tier: string, rule: string, name?: string) => {
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].tier, tier);
  assert.equal(found[0].rule, rule);
  if (name !== undefined) assert.equal(found[0].name, name);
};

// ── Additions pass ──────────────────────────────────────────────────────────────

test("identical schemas are compatible", () => {
  assert.deepEqual(diffSchema(F, base(), base()), []);
});

test("additions pass: new optional property, new enum member, new nested property, new definition", () => {
  const next = base();
  next.properties.extra = { type: "string" };
  next.properties.status.enum.push("maybe");
  next.properties.tags.items.properties.colour = { type: "string" };
  next.definitions.Fresh = { type: "object" };
  assert.deepEqual(diffSchema(F, base(), next), []);
});

test("additionalProperties absent and true are the same; already false stays compatible", () => {
  const open = base();
  open.additionalProperties = true;
  assert.deepEqual(diffSchema(F, base(), open), []);
  const closed = base();
  closed.additionalProperties = false;
  assert.deepEqual(diffSchema(F, closed, closed), []);
});

test("a new schema file and new constants keys and members pass", () => {
  const result = compareTrees(
    { "src/constants/a.json": { keep: [1], nested: { x: "a" } } },
    { "src/constants/a.json": { keep: [1, 2], nested: { x: "a", y: "b" }, added: "x" }, "src/schemas/new.schema.json": base() },
    [],
    TODAY,
  );
  assert.deepEqual(result.breaking, []);
  assert.deepEqual(result.risky, []);
});

// ── HARD rules: each one fails ──────────────────────────────────────────────────

test("HARD: property removed", () => {
  const next = base();
  delete next.properties.status;
  only(diffSchema(F, base(), next), "hard", "property-removed", `${F}#/properties/status`);
});

test("HARD: nested property removed", () => {
  const next = base();
  delete next.properties.tags.items.properties.label;
  only(diffSchema(F, base(), next), "hard", "property-removed", `${F}#/properties/tags/items/properties/label`);
});

test("HARD: property removed from required is reported once, as the removal", () => {
  const next = base();
  delete next.properties.name;
  next.required = ["id"];
  only(diffSchema(F, base(), next), "hard", "property-removed", `${F}#/properties/name`);
});

test("HARD: type narrowed (number to string, and a lost union member)", () => {
  const next = base();
  next.properties.count.type = "string";
  only(diffSchema(F, base(), next), "hard", "type-narrowed", `${F}#/properties/count/type`);

  const wide = base();
  wide.properties.name.type = ["string", "null"];
  only(diffSchema(F, wide, base()), "hard", "type-narrowed", `${F}#/properties/name/type`);
});

test("HARD: number narrowed to integer", () => {
  const before = base();
  before.properties.count.type = "number";
  only(diffSchema(F, before, base()), "hard", "type-narrowed");
});

test("HARD: type lost", () => {
  const next = base();
  delete next.properties.name.type;
  only(diffSchema(F, base(), next), "hard", "type-lost", `${F}#/properties/name/type`);
});

test("HARD: a type added where the baseline accepted anything", () => {
  const before = base();
  delete before.properties.name.type;
  only(diffSchema(F, before, base()), "hard", "type-narrowed");
});

test("HARD: enum value removed", () => {
  const next = base();
  next.properties.status.enum = ["yes", "no"];
  const v = diffSchema(F, base(), next);
  only(v, "hard", "enum-value-removed", `${F}#/properties/status/enum/unknown`);
  assert.equal(v[0].removal, true);
});

test("HARD: property newly added to required, and a brand new property that is also required", () => {
  const next = base();
  next.required.push("count");
  only(diffSchema(F, base(), next), "hard", "required-added", `${F}#/required/count`);

  const fresh = base();
  fresh.properties.fresh = { type: "string" };
  fresh.required.push("fresh");
  only(diffSchema(F, base(), fresh), "hard", "required-added");
});

test("HARD: additionalProperties true or absent -> false", () => {
  const closed = base();
  closed.additionalProperties = false;
  only(diffSchema(F, base(), closed), "hard", "additional-properties-closed");
  const open = base();
  open.additionalProperties = true;
  only(diffSchema(F, open, closed), "hard", "additional-properties-closed");
});

test("HARD: definition removed", () => {
  const next = base();
  delete next.definitions.Owner;
  only(diffSchema(F, base(), next), "hard", "definition-removed", `${F}#/definitions/Owner`);
});

test("HARD: schema file removed", () => {
  const result = compareTrees({ "src/schemas/p.schema.json": base() }, {}, [], TODAY);
  assert.deepEqual(rules(result.breaking), ["file-removed"]);
});

test("HARD: constants key path removed", () => {
  const v = diffConstants("community.json", { thresholds: { MIN: 3, HIGH: 10 } }, { thresholds: { MIN: 3 } });
  only(v, "hard", "constant-removed", "community.json#thresholds.HIGH");
});

test("HARD: constants array member removed, of any JSON type", () => {
  const strings = diffConstants("c.json", { status: ["yes", "no", "check"] }, { status: ["yes", "no"] });
  only(strings, "hard", "constant-member-removed", "c.json#status[check]");

  const numbers = diffConstants("c.json", { sizes: [1, 2, 3] }, { sizes: [1, 3] });
  only(numbers, "hard", "constant-member-removed", "c.json#sizes[2]");

  const objects = diffConstants("c.json", { rows: [{ a: 1, b: 2 }, { c: 3 }] }, { rows: [{ b: 2, a: 1 }] });
  only(objects, "hard", "constant-member-removed", 'c.json#rows[{"c":3}]');

  const nulls = diffConstants("c.json", { v: [null, true] }, { v: [true] });
  only(nulls, "hard", "constant-member-removed", "c.json#v[null]");

  // Reordering is not a removal; objects compare by canonical JSON text.
  assert.deepEqual(diffConstants("c.json", { rows: [{ a: 1, b: 2 }, 5] }, { rows: [5, { b: 2, a: 1 }] }), []);
});

test("HARD: an array replaced by a non-array loses every member", () => {
  const v = diffConstants("c.json", { status: ["yes", "no"] }, { status: "yes" });
  assert.deepEqual(rules(v), ["constant-member-removed", "constant-member-removed"]);
});

// ── RISKY rules: each one fails ─────────────────────────────────────────────────

test("RISKY: type widened (string to a union with object, as in a PlaceDto array reader)", () => {
  const next = base();
  next.properties.photos.items.type = ["string", "object"];
  only(diffSchema(F, base(), next), "risky", "type-widened", `${F}#/properties/photos/items/type`);
});

test("RISKY: type widened with null", () => {
  const next = base();
  next.properties.name.type = ["string", "null"];
  only(diffSchema(F, base(), next), "risky", "type-widened", `${F}#/properties/name/type`);
});

test("RISKY: integer to number", () => {
  const next = base();
  next.properties.count.type = "number";
  only(diffSchema(F, base(), next), "risky", "type-widened", `${F}#/properties/count/type`);
});

test("RISKY: a type replaced by a $ref (reported once)", () => {
  const next = base();
  next.properties.name = { $ref: "#/definitions/Owner" };
  only(diffSchema(F, base(), next), "risky", "type-replaced", `${F}#/properties/name/type`);
});

test("RISKY: a type replaced by a combinator", () => {
  const next = base();
  next.properties.name = { oneOf: [{ type: "string" }] };
  assert.deepEqual(rules(diffSchema(F, base(), next)), ["combinator-changed", "type-replaced"]);
});

test("RISKY: an entry removed from required", () => {
  const next = base();
  next.required = ["id"];
  only(diffSchema(F, base(), next), "risky", "required-removed", `${F}#/required/name`);
});

test("RISKY: items type changed, items shape changed, tuple form, items dropped", () => {
  const typeChange = base();
  typeChange.properties.photos.items = { type: "number" };
  only(diffSchema(F, base(), typeChange), "hard", "type-narrowed"); // string lost: hard wins

  const widened = base();
  widened.properties.photos.items = { type: ["string", "null"] };
  only(diffSchema(F, base(), widened), "risky", "type-widened", `${F}#/properties/photos/items/type`);

  const tuple = base();
  tuple.properties.photos.items = [{ type: "string" }];
  only(diffSchema(F, base(), tuple), "risky", "items-changed", `${F}#/properties/photos/items`);

  const dropped = base();
  delete dropped.properties.photos.items;
  only(diffSchema(F, base(), dropped), "risky", "items-changed", `${F}#/properties/photos/items`);

  const tupleChanged = base();
  tupleChanged.properties.photos.items = [{ type: "string" }];
  const tupleChanged2 = base();
  tupleChanged2.properties.photos.items = [{ type: "string" }, { type: "number" }];
  only(diffSchema(F, tupleChanged, tupleChanged2), "risky", "items-changed");
});

test("RISKY: items nested object shape changes are walked (new required inside is HARD)", () => {
  const next = base();
  next.properties.tags.items.required = ["label"];
  only(diffSchema(F, base(), next), "hard", "required-added", `${F}#/properties/tags/items/required/label`);
});

for (const [keyword, value] of [
  ["const", "x"],
  ["pattern", "^a$"],
  ["minLength", 1],
  ["maxLength", 5],
  ["minimum", 0],
  ["maximum", 9],
  ["exclusiveMinimum", 0],
  ["exclusiveMaximum", 9],
  ["multipleOf", 2],
  ["format", "uri"],
  ["minItems", 1],
  ["maxItems", 3],
  ["uniqueItems", true],
  ["minProperties", 1],
  ["maxProperties", 4],
] as const) {
  test(`RISKY: ${keyword} added where the baseline lacked it, changed, or dropped`, () => {
    const added = base();
    added.properties.name[keyword] = value;
    only(diffSchema(F, base(), added), "risky", "keyword-changed", `${F}#/properties/name/${keyword}`);

    const changed = base();
    changed.properties.name[keyword] = typeof value === "number" ? value + 1 : typeof value === "boolean" ? !value : `${value}!`;
    only(diffSchema(F, added, changed), "risky", "keyword-changed", `${F}#/properties/name/${keyword}`);

    only(diffSchema(F, added, base()), "risky", "keyword-changed", `${F}#/properties/name/${keyword}`);
    assert.deepEqual(diffSchema(F, added, added), []);
  });
}

test("RISKY: enum added where the baseline lacked it, and enum dropped", () => {
  const added = base();
  added.properties.name.enum = ["a", "b"];
  only(diffSchema(F, base(), added), "risky", "keyword-changed", `${F}#/properties/name/enum`);
  only(diffSchema(F, added, base()), "risky", "keyword-changed", `${F}#/properties/name/enum`);
});

test("RISKY: $ref retargeted", () => {
  const next = base();
  next.definitions.Other = { type: "object", properties: { uid: { type: "string" } } };
  next.properties.owner = { $ref: "#/definitions/Other" };
  only(diffSchema(F, base(), next), "risky", "ref-retargeted", `${F}#/properties/owner/$ref`);
});

test("RISKY: oneOf, anyOf, allOf and not changed (canonical JSON, key order ignored)", () => {
  for (const kw of ["oneOf", "anyOf", "allOf", "not"]) {
    const before = base();
    before.properties.name[kw] = kw === "not" ? { type: "number", minimum: 1 } : [{ type: "string", minLength: 1 }];
    const same = base();
    same.properties.name[kw] = kw === "not" ? { minimum: 1, type: "number" } : [{ minLength: 1, type: "string" }];
    assert.deepEqual(diffSchema(F, before, same), [], kw);

    const after = base();
    after.properties.name[kw] = kw === "not" ? { type: "boolean" } : [{ type: "number" }];
    const found = diffSchema(F, before, after);
    only(found, "risky", "combinator-changed", `${F}#/properties/name/${kw}`);
  }
});

test("RISKY: title changed (it names the generated Kotlin class) and $id changed", () => {
  const retitled = base();
  retitled.title = "Q";
  only(diffSchema(F, base(), retitled), "risky", "title-changed", `${F}#/title`);

  const reid = base();
  reid.$id = "https://example.test/other.json";
  only(diffSchema(F, base(), reid), "risky", "id-changed", `${F}#/$id`);

  const nested = base();
  nested.definitions.Owner.title = "Owner";
  only(diffSchema(F, base(), nested), "risky", "title-changed", `${F}#/definitions/Owner/title`);
});

test("RISKY: additionalProperties sub-schema changed, or opened from false", () => {
  const before = base();
  before.additionalProperties = { $ref: "#/definitions/Owner" };
  const after = base();
  after.additionalProperties = { type: "string" };
  only(diffSchema(F, before, after), "risky", "additional-properties-changed", `${F}#/additionalProperties`);

  const closed = base();
  closed.additionalProperties = false;
  only(diffSchema(F, closed, base()), "risky", "additional-properties-changed");

  // A sub-schema closed to false is HARD, not risky.
  only(diffSchema(F, before, closed), "hard", "additional-properties-closed");
});

test("RISKY: any constants scalar value changed (number, string, boolean, null)", () => {
  const v = diffConstants("m.json", { radius: 50, name: "a", on: true, none: null }, { radius: 5, name: "b", on: false, none: 0 });
  assert.deepEqual(rules(v), ["constant-changed", "constant-changed", "constant-changed", "constant-changed"]);
  assert.ok(v.every((f) => f.tier === "risky"));
  assert.deepEqual(v.map((f) => f.name).sort(), ["m.json#name", "m.json#none", "m.json#on", "m.json#radius"]);
});

test("RISKY: a nested constants scalar changed, and a scalar replaced by an object", () => {
  only(diffConstants("m.json", { a: { b: 1 } }, { a: { b: 2 } }), "risky", "constant-changed", "m.json#a.b");
  only(diffConstants("m.json", { a: 1 }, { a: { b: 1 } }), "risky", "constant-changed", "m.json#a");
});

// ── Acknowledgements ────────────────────────────────────────────────────────────

const photosWidened = () => {
  const next = base();
  next.properties.photos.items.type = ["string", "object"];
  return next;
};
const photoName = `${F}#/properties/photos/items/type`;
const compareWith = (acks: unknown, version = "1.2.0") =>
  compareTrees({ "src/schemas/p.schema.json": base() }, { "src/schemas/p.schema.json": photosWidened() }, [], TODAY, acks as any, version);

test("a RISKY finding with no acknowledgement is reported", () => {
  const result = compareWith([]);
  assert.deepEqual(rules(result.risky), ["type-widened"]);
  assert.deepEqual(result.breaking, []);
});

test("a RISKY finding is accepted by a matching acknowledgement for this version", () => {
  const result = compareWith([{ name: photoName, acknowledgedIn: "1.2.0", reason: "Android reader updated in 1008" }]);
  assert.deepEqual(result.risky, []);
  assert.equal(result.acknowledged.length, 1);
  assert.deepEqual(result.notices, []);
});

test("an acknowledgement for another version does not accept the finding", () => {
  const result = compareWith([{ name: photoName, acknowledgedIn: "1.1.0", reason: "old" }]);
  assert.equal(result.risky.length, 1);
  assert.match(result.risky[0].message, /acknowledgement not accepted/);
  assert.deepEqual(result.acknowledged, []);
});

test("an acknowledgement with an empty or missing reason does not accept the finding", () => {
  for (const reason of ["", "   ", undefined, 7]) {
    const result = compareWith([{ name: photoName, acknowledgedIn: "1.2.0", reason }]);
    assert.equal(result.risky.length, 1, String(reason));
    assert.match(result.risky[0].message, /reason is empty/);
  }
});

test("an acknowledgement with a different name does not accept the finding and is a NOTICE", () => {
  const result = compareWith([{ name: `${F}#/properties/other/type`, acknowledgedIn: "1.2.0", reason: "x" }]);
  assert.equal(result.risky.length, 1);
  assert.equal(result.notices.length, 1);
  assert.match(result.notices[0], /matches no RISKY finding/);
});

test("a stale acknowledgement matching nothing is reported as a NOTICE even when nothing is risky", () => {
  const result = compareTrees(
    { "src/schemas/p.schema.json": base() },
    { "src/schemas/p.schema.json": base() },
    [],
    TODAY,
    [{ name: photoName, acknowledgedIn: "1.0.0", reason: "stale" }],
    "1.2.0",
  );
  assert.deepEqual(result.risky, []);
  assert.equal(result.notices.length, 1);
});

test("without a version no acknowledgement is accepted", () => {
  const result = compareTrees(
    { "src/schemas/p.schema.json": base() },
    { "src/schemas/p.schema.json": photosWidened() },
    [],
    TODAY,
    [{ name: photoName, acknowledgedIn: "1.2.0", reason: "x" }],
    undefined,
  );
  assert.equal(result.risky.length, 1);
});

test("a HARD finding can never be acknowledged", () => {
  const next = base();
  next.properties.name.type = "number";
  const result = compareTrees(
    { "src/schemas/p.schema.json": base() },
    { "src/schemas/p.schema.json": next },
    [],
    TODAY,
    [{ name: `${F}#/properties/name/type`, acknowledgedIn: "1.2.0", reason: "please" }],
    "1.2.0",
  );
  assert.deepEqual(rules(result.breaking), ["type-narrowed"]);
  assert.equal(result.notices.length, 1);
  assert.match(result.notices[0], /HARD/);
});

test("a removal cannot be excused by an acknowledgement, only by a deprecation", () => {
  const next = base();
  delete next.properties.name;
  next.required = ["id"];
  const result = compareTrees(
    { "src/schemas/p.schema.json": base() },
    { "src/schemas/p.schema.json": next },
    [],
    TODAY,
    [{ name: `${F}#/properties/name`, acknowledgedIn: "1.2.0", reason: "please" }],
    "1.2.0",
  );
  assert.deepEqual(rules(result.breaking), ["property-removed"]);
});

test("applyAcknowledgements tolerates garbage entries", () => {
  const found = diffSchema(F, base(), photosWidened());
  const out = applyAcknowledgements(found, [null, 3, "x", { name: photoName, acknowledgedIn: "1.2.0", reason: "ok" }], "1.2.0");
  assert.deepEqual(out.unacknowledged, []);
  assert.equal(out.acknowledged.length, 1);
  assert.deepEqual(applyAcknowledgements(found, undefined as any, "1.2.0").unacknowledged.length, 1);
});

// ── Deprecation window ──────────────────────────────────────────────────────────

const removedName = { name: `${F}#/properties/status`, deprecatedIn: "v1.1.0", removeAfter: "2026-09-01" };
const removeStatus = () => {
  const next = base();
  delete next.properties.status;
  return next;
};

test("a removal listed in deprecations.json with removeAfter in the past is allowed", () => {
  const result = compareTrees({ "src/schemas/p.schema.json": base() }, { "src/schemas/p.schema.json": removeStatus() }, [removedName], TODAY);
  assert.deepEqual(result.breaking, []);
  assert.equal(result.allowed.length, 1);
});

test("removeAfter equal to today is allowed", () => {
  const result = compareTrees(
    { "src/schemas/p.schema.json": base() },
    { "src/schemas/p.schema.json": removeStatus() },
    [{ ...removedName, removeAfter: TODAY }],
    TODAY,
  );
  assert.deepEqual(result.breaking, []);
});

test("a removal inside its deprecation window (removeAfter in the future) is still BREAKING", () => {
  const result = compareTrees(
    { "src/schemas/p.schema.json": base() },
    { "src/schemas/p.schema.json": removeStatus() },
    [{ ...removedName, removeAfter: "2026-12-31" }],
    TODAY,
  );
  assert.deepEqual(rules(result.breaking), ["property-removed"]);
  assert.match(result.breaking[0].message, /removeAfter 2026-12-31/);
});

test("a deprecation entry for a different name does not cover the removal", () => {
  const result = compareTrees(
    { "src/schemas/p.schema.json": base() },
    { "src/schemas/p.schema.json": removeStatus() },
    [{ ...removedName, name: `${F}#/properties/other` }],
    TODAY,
  );
  assert.deepEqual(rules(result.breaking), ["property-removed"]);
});

test("deprecation can never excuse a type narrowing, new required field or closed additionalProperties", () => {
  const next = base();
  next.properties.count.type = "string";
  next.required.push("count");
  next.additionalProperties = false;
  const found = diffSchema(F, base(), next);
  const entries = found.map((v: any) => ({ name: v.name, deprecatedIn: "v1.1.0", removeAfter: "2000-01-01" }));
  const result = applyDeprecations(found, entries, TODAY);
  assert.equal(result.breaking.length, 3);
  assert.deepEqual(result.allowed, []);
});

test("a deprecation never excuses a RISKY finding", () => {
  const found = diffSchema(F, base(), photosWidened());
  const entries = found.map((v: any) => ({ name: v.name, deprecatedIn: "v1.1.0", removeAfter: "2000-01-01" }));
  const result = compareTrees(
    { "src/schemas/p.schema.json": base() },
    { "src/schemas/p.schema.json": photosWidened() },
    entries,
    TODAY,
    [],
    "1.2.0",
  );
  assert.equal(result.risky.length, 1);
});

test("an enum value, a constants key and a constants array member removal can be covered by a matured deprecation", () => {
  const next = base();
  next.properties.status.enum = ["yes", "no"];
  const found = [
    ...diffSchema(F, base(), next),
    ...diffConstants("community.json", { a: { b: 1 }, list: [7] }, { a: {}, list: [] }),
  ];
  const entries = [
    { name: `${F}#/properties/status/enum/unknown`, deprecatedIn: "v1.1.0", removeAfter: "2026-01-01" },
    { name: "community.json#a.b", deprecatedIn: "v1.1.0", removeAfter: "2026-01-01" },
    { name: "community.json#list[7]", deprecatedIn: "v1.1.0", removeAfter: "2026-01-01" },
  ];
  const result = applyDeprecations(found, entries, TODAY);
  assert.deepEqual(result.breaking, []);
  assert.equal(result.allowed.length, 3);
});

// ── Baseline selection ──────────────────────────────────────────────────────────

const fakeGit = (tagsAtHead: string, describe: string | Error, calls: string[][] = []) => (args: string[]) => {
  calls.push(args);
  if (args[0] === "tag") return tagsAtHead;
  if (args[0] === "describe") {
    if (describe instanceof Error) throw describe;
    return describe;
  }
  throw new Error(`unexpected git call: ${args.join(" ")}`);
};

test("baseline: tags pointing at HEAD are each passed to git describe as --exclude", () => {
  const calls: string[][] = [];
  const out = chooseBaseline(fakeGit("v1.1.0\nv1.1.0-rc1\n", "v1.0.0\n", calls));
  assert.deepEqual(out, { tag: "v1.0.0", excluded: ["v1.1.0", "v1.1.0-rc1"] });
  assert.deepEqual(calls[0], ["tag", "--points-at", "HEAD"]);
  assert.deepEqual(calls[1], ["describe", "--tags", "--abbrev=0", "--exclude", "v1.1.0", "--exclude", "v1.1.0-rc1"]);
});

test("baseline: an untagged HEAD excludes nothing, as before", () => {
  const calls: string[][] = [];
  const out = chooseBaseline(fakeGit("", "v1.1.0\n", calls));
  assert.deepEqual(out, { tag: "v1.1.0", excluded: [] });
  assert.deepEqual(calls[1], ["describe", "--tags", "--abbrev=0"]);
});

test("baseline: no earlier tag gives an empty tag (the caller exits 2)", () => {
  assert.equal(chooseBaseline(fakeGit("v1.0.0\n", new Error("fatal: No names found"))).tag, "");
});

test("baseline: a failing git tag still lets describe run", () => {
  const run = (args: string[]) => {
    if (args[0] === "tag") throw new Error("boom");
    return "v1.0.0\n";
  };
  assert.deepEqual(chooseBaseline(run), { tag: "v1.0.0", excluded: [] });
});
