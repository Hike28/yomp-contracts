// yomp-contracts compatibility check, judged for READERS, in two tiers.
//
//   node scripts/check-compat.mjs        (npm run check:compat)
//
// Compatibility here means "the hand-written readers still parse what the contract describes"
// (Android 1004-1007 PlaceDto, yomp-api's vendored types). A reader breaks when a response gets
// STRICTER and also when it gets LOOSER (a type widened so a string appears where a Double is
// parsed; a field dropped from `required` so it may be missing). So there are two tiers.
//
// Baseline = the latest tag reachable from HEAD that does NOT point at HEAD itself, so a tagged
// release is compared with the release before it, never with itself. Every src/schemas/*.schema.json
// and src/constants/*.json at that tag is compared with the working tree. Pure additions pass.
//
// Scope: the authored sources only (src/schemas, src/constants). build/ is generated from them and is
// protected by CI's generated-files-up-to-date step; a scripts/build.mjs change that alters generated
// names or types without a schema edit is NOT covered here.
//
// HARD (exit 1; only a REMOVAL can be excused, by a matured deprecations.json entry at the baseline;
// removing a property that was in the baseline `required` list can NOT be excused: make it optional first):
//   schema file removed · property removed · type narrowed or lost (incl. a schema node replaced by
//   true/false/any non-object) · enum value removed ·
//   property newly in `required` · additionalProperties true/absent -> false ·
//   constants key path removed · constants array member removed (any JSON type, by JSON text)
//
// RISKY (exit 1 unless acknowledged in compat-acknowledgements.json for THIS package.json version,
// which must also DIFFER from the package.json version at the baseline tag):
//   type widened (incl. integer -> number) or replaced by a $ref · entry removed from `required` ·
//   items changed (incl. tuple form) · enum/const/pattern/minLength/maxLength/minimum/maximum/
//   exclusiveMinimum/exclusiveMaximum/multipleOf/format (and minItems/maxItems/uniqueItems/
//   minProperties/maxProperties) added, dropped or changed · $ref retargeted ·
//   oneOf/anyOf/allOf/not changed · title or $id changed (title names the generated Kotlin class) ·
//   additionalProperties sub-schema changed (or opened from false) · any constants scalar changed
//
// Deprecation entry:  { "name": "<file>#<pointer or key path>", "deprecatedIn": "<tag>", "removeAfter": "YYYY-MM-DD" }
//   removeAfter must be a real calendar date; anything else is an invalid entry (exit 1), never matured.
//   Names are matched literally. Reordering a constants array is not detected (known limits).
// Acknowledgement:    { "name": "<same naming>", "acknowledgedIn": "<package.json version>", "reason": "<text>" }
// HARD findings can never be acknowledged. Unmatched acknowledgements are printed as NOTICEs.
//
// Exit codes: 0 compatible · 1 BREAKING or unacknowledged RISKY · 2 check did not run.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_DIR = "src/schemas";
const CONSTANTS_DIR = "src/constants";
const ACK_FILE = "compat-acknowledgements.json";

// ── Pure diff ─────────────────────────────────────────────────────────────────

// A finding: { tier: "hard"|"risky", name, rule, message, removal }. `name` is the deprecation /
// acknowledgement key.
const finding = (tier, name, rule, message, removal = false) => ({ tier, name, rule, message, removal });
const hard = (name, rule, message, removal = false) => finding("hard", name, rule, message, removal);
const risky = (name, rule, message) => finding("risky", name, rule, message);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** True only for a string written YYYY-MM-DD that is a real calendar date (2026-02-30 is not). */
export function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
const typeSet = (t) => (t === undefined ? null : new Set(Array.isArray(t) ? t : [t]));

const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isObject(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
};
/** Canonical JSON text (object keys sorted, array order kept). `undefined` stays `undefined`. */
const canon = (v) => (v === undefined ? undefined : JSON.stringify(sortKeys(v)));

const COMBINATORS = ["oneOf", "anyOf", "allOf", "not"];
const VALUE_KEYWORDS = [
  "const",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
];

// additionalProperties absent and `true` are the same thing.
const canonAdditional = (v) => (v === undefined || v === true ? "true" : canon(v));

// Compare two schema nodes at `pointer`. Walks properties, items and definitions.
function diffNode(file, pointer, oldNode, newNode, out) {
  const at = (suffix) => `${file}#${pointer}${suffix}`;
  if (!isObject(oldNode)) return;
  if (!isObject(newNode)) {
    // An object schema node replaced by true, false or any other non-object is the same as `{}`:
    // the baseline's type (and everything else it said) is gone.
    out.push(
      hard(
        at("/type"),
        "type-lost",
        `schema node replaced by a non-object (${JSON.stringify(newNode)}): the baseline type ${JSON.stringify(oldNode.type)} is lost`,
      ),
    );
    return;
  }

  // type
  const oldTypes = typeSet(oldNode.type);
  const newTypes = typeSet(newNode.type);
  const newIsRef = newNode.$ref !== undefined;
  const newHasCombinator = COMBINATORS.some((k) => newNode[k] !== undefined);
  const oldHasRefOrCombinator = oldNode.$ref !== undefined || COMBINATORS.some((k) => oldNode[k] !== undefined);
  let typeReplacedByRef = false;
  if (oldTypes && newTypes) {
    // integer is a subset of number for acceptance, but the generated Kotlin type changes, so
    // integer -> number is reported as a (risky) widening rather than passing.
    const covered = (t) => newTypes.has(t) || (t === "integer" && newTypes.has("number"));
    const lost = [...oldTypes].filter((t) => !covered(t));
    if (lost.length > 0) {
      out.push(
        hard(
          at("/type"),
          "type-narrowed",
          `type narrowed or changed: ${JSON.stringify(oldNode.type)} -> ${JSON.stringify(newNode.type)}`,
        ),
      );
    } else if (canon([...oldTypes].sort()) !== canon([...newTypes].sort())) {
      out.push(
        risky(
          at("/type"),
          "type-widened",
          `type widened or changed: ${JSON.stringify(oldNode.type)} -> ${JSON.stringify(newNode.type)}`,
        ),
      );
    }
  } else if (oldTypes && !newTypes) {
    if (newIsRef || newHasCombinator) {
      typeReplacedByRef = newIsRef;
      out.push(
        risky(
          at("/type"),
          "type-replaced",
          `type ${JSON.stringify(oldNode.type)} replaced by ${newIsRef ? "a $ref" : "a combinator"}`,
        ),
      );
    } else {
      out.push(hard(at("/type"), "type-lost", `type removed: ${JSON.stringify(oldNode.type)} -> (none)`));
    }
  } else if (!oldTypes && newTypes && !oldHasRefOrCombinator) {
    out.push(
      hard(at("/type"), "type-narrowed", `type added where the baseline accepted any type: ${JSON.stringify(newNode.type)}`),
    );
  }

  // enum
  if (Array.isArray(oldNode.enum) && Array.isArray(newNode.enum)) {
    for (const v of oldNode.enum) {
      if (!newNode.enum.some((n) => canon(n) === canon(v))) {
        out.push(hard(at(`/enum/${String(v)}`), "enum-value-removed", `enum value removed: ${JSON.stringify(v)}`, true));
      }
    }
  } else if (canon(oldNode.enum) !== canon(newNode.enum)) {
    out.push(
      risky(
        at("/enum"),
        "keyword-changed",
        `enum ${oldNode.enum === undefined ? "added" : "dropped or changed"}: ${canon(oldNode.enum)} -> ${canon(newNode.enum)}`,
      ),
    );
  }

  // const, pattern, bounds, format ...
  for (const kw of VALUE_KEYWORDS) {
    if (canon(oldNode[kw]) !== canon(newNode[kw])) {
      out.push(
        risky(at(`/${kw}`), "keyword-changed", `${kw} changed: ${canon(oldNode[kw])} -> ${canon(newNode[kw])}`),
      );
    }
  }

  // $ref, combinators, title, $id
  if (oldNode.$ref !== newNode.$ref && !(typeReplacedByRef && oldNode.$ref === undefined)) {
    out.push(risky(at("/$ref"), "ref-retargeted", `$ref changed: ${canon(oldNode.$ref)} -> ${canon(newNode.$ref)}`));
  }
  for (const kw of COMBINATORS) {
    if (canon(oldNode[kw]) !== canon(newNode[kw])) {
      out.push(risky(at(`/${kw}`), "combinator-changed", `${kw} changed`));
    }
  }
  if (canon(oldNode.title) !== canon(newNode.title)) {
    out.push(
      risky(at("/title"), "title-changed", `title changed: ${canon(oldNode.title)} -> ${canon(newNode.title)} (names the generated Kotlin class)`),
    );
  }
  if (canon(oldNode.$id) !== canon(newNode.$id)) {
    out.push(risky(at("/$id"), "id-changed", `$id changed: ${canon(oldNode.$id)} -> ${canon(newNode.$id)}`));
  }

  // properties and required
  const oldProps = isObject(oldNode.properties) ? oldNode.properties : {};
  const newProps = isObject(newNode.properties) ? newNode.properties : {};
  const oldRequired = Array.isArray(oldNode.required) ? oldNode.required : [];
  const newRequired = Array.isArray(newNode.required) ? newNode.required : [];
  for (const r of newRequired) {
    if (!oldRequired.includes(r)) {
      out.push(hard(at(`/required/${r}`), "required-added", `property newly required: "${r}"`));
    }
  }
  for (const r of oldRequired) {
    // A property that was removed outright is reported once, as the (hard) removal.
    if (!newRequired.includes(r) && !(r in oldProps && !(r in newProps))) {
      out.push(risky(at(`/required/${r}`), "required-removed", `property no longer required: "${r}" (may now be missing)`));
    }
  }

  // additionalProperties
  const oa = oldNode.additionalProperties;
  const na = newNode.additionalProperties;
  if (oa !== false && na === false) {
    out.push(
      hard(at("/additionalProperties"), "additional-properties-closed", "additionalProperties changed from true/absent to false"),
    );
  } else if (isObject(oa) && !isObject(na)) {
    // A sub-schema replaced by true, absent or any other non-object loses its type.
    out.push(
      hard(
        at("/additionalProperties/type"),
        "type-lost",
        `additionalProperties sub-schema replaced by a non-object (${na === undefined ? "absent" : JSON.stringify(na)}): the baseline type ${JSON.stringify(oa.type)} is lost`,
      ),
    );
  } else if (canonAdditional(oa) !== canonAdditional(na)) {
    out.push(
      risky(
        at("/additionalProperties"),
        "additional-properties-changed",
        `additionalProperties changed: ${canon(oa)} -> ${canon(na)}`,
      ),
    );
  }

  for (const key of Object.keys(oldProps)) {
    if (!(key in newProps)) {
      if (oldRequired.includes(key)) {
        // A required field disappearing makes readers drop whole rows or fail, so no deprecation
        // window can excuse it: make it optional first (RISKY), release, deprecate, then remove.
        out.push(
          hard(
            at(`/properties/${key}`),
            "property-removed",
            `required property removed: "${key}" (cannot be deprecated away: make it optional first, release, deprecate, then remove)`,
          ),
        );
      } else {
        out.push(hard(at(`/properties/${key}`), "property-removed", `property removed: "${key}"`, true));
      }
    } else {
      diffNode(file, `${pointer}/properties/${key}`, oldProps[key], newProps[key], out);
    }
  }

  // items (single schema recurses; tuple form or a shape change is compared as a whole)
  if (isObject(oldNode.items) && newNode.items !== undefined && !Array.isArray(newNode.items)) {
    diffNode(file, `${pointer}/items`, oldNode.items, newNode.items, out);
  } else if (canon(oldNode.items) !== canon(newNode.items)) {
    out.push(risky(at("/items"), "items-changed", `items changed: ${canon(oldNode.items)} -> ${canon(newNode.items)}`));
  }

  for (const bag of ["definitions", "$defs"]) {
    const oldDefs = isObject(oldNode[bag]) ? oldNode[bag] : {};
    const newDefs = isObject(newNode[bag]) ? newNode[bag] : {};
    for (const key of Object.keys(oldDefs)) {
      if (!(key in newDefs)) {
        out.push(hard(at(`/${bag}/${key}`), "definition-removed", `definition removed: "${key}"`, true));
      } else {
        diffNode(file, `${pointer}/${bag}/${key}`, oldDefs[key], newDefs[key], out);
      }
    }
  }
}

/** Findings between two parsed JSON Schemas (file is the bare file name). */
export function diffSchema(file, oldSchema, newSchema) {
  const out = [];
  diffNode(file, "", oldSchema, newSchema, out);
  return out;
}

// Constants: a removed key path or array member is hard; a changed scalar is risky.
function diffConstantNode(file, path, oldValue, newValue, out) {
  if (isObject(oldValue)) {
    for (const key of Object.keys(oldValue)) {
      const here = path === "" ? key : `${path}.${key}`;
      if (!isObject(newValue) || !(key in newValue)) {
        out.push(hard(`${file}#${here}`, "constant-removed", `constant key removed: ${here}`, true));
      } else {
        diffConstantNode(file, here, oldValue[key], newValue[key], out);
      }
    }
  } else if (Array.isArray(oldValue)) {
    const present = Array.isArray(newValue) ? new Set(newValue.map((m) => canon(m))) : new Set();
    for (const member of oldValue) {
      if (!present.has(canon(member))) {
        // Strings keep their bare text in the name (key[member]); other types use their JSON text.
        const text = typeof member === "string" ? member : canon(member);
        out.push(
          hard(
            `${file}#${path}[${text}]`,
            "constant-member-removed",
            `array member removed from ${path}: ${canon(member)}`,
            true,
          ),
        );
      }
    }
  } else if (path !== "" && canon(oldValue) !== canon(newValue)) {
    out.push(
      risky(`${file}#${path}`, "constant-changed", `constant value changed at ${path}: ${canon(oldValue)} -> ${canon(newValue)}`),
    );
  }
}

/** Findings between two parsed constants files. */
export function diffConstants(file, oldValue, newValue) {
  const out = [];
  diffConstantNode(file, "", oldValue, newValue, out);
  return out;
}

/**
 * Drop HARD removal findings covered by a matured deprecation entry. Returns { breaking, allowed };
 * a listed-but-not-yet-matured removal stays breaking with a clear message. Non-removals and RISKY
 * findings pass through to `breaking` untouched (they can never be deprecated away).
 */
export function applyDeprecations(findings, deprecations, today) {
  const entries = Array.isArray(deprecations) ? deprecations : [];
  const breaking = [];
  const allowed = [];
  // Every entry whose removeAfter is not a real YYYY-MM-DD date is a problem in its own right and
  // can never mature.
  const problems = [];
  for (const e of entries) {
    if (!isObject(e)) {
      problems.push(`deprecation entry ${JSON.stringify(e)} is not an object`);
    } else if (!isIsoDate(e.removeAfter)) {
      problems.push(
        `deprecation entry ${JSON.stringify(e.name)} has an invalid removeAfter ${JSON.stringify(e.removeAfter)}: it must be a real calendar date written YYYY-MM-DD`,
      );
    }
  }
  for (const v of findings) {
    const entry = v.removal ? entries.find((e) => isObject(e) && e.name === v.name) : undefined;
    if (!entry) {
      breaking.push(v);
    } else if (!isIsoDate(entry.removeAfter)) {
      breaking.push({
        ...v,
        message: `${v.message} (deprecation entry ignored: removeAfter ${JSON.stringify(entry.removeAfter)} is not a real YYYY-MM-DD date)`,
      });
    } else if (entry.removeAfter <= today) {
      allowed.push({ ...v, deprecation: entry });
    } else {
      breaking.push({
        ...v,
        message: `${v.message} (deprecated in ${entry.deprecatedIn}, but removeAfter ${entry.removeAfter} is after ${today})`,
      });
    }
  }
  return { breaking, allowed, problems };
}

/**
 * Resolve RISKY findings against compat-acknowledgements.json. An entry counts only when its name
 * matches, `acknowledgedIn` equals `version` and `reason` is non-empty. Returns
 * { unacknowledged, acknowledged, notices }. Entries matching no RISKY finding (including entries
 * naming a HARD finding, which can never be acknowledged) come back as notices.
 */
export function applyAcknowledgements(riskyFindings, acknowledgements, version, hardFindings = [], baselineVersion = undefined) {
  const entries = Array.isArray(acknowledgements) ? acknowledgements.filter((e) => isObject(e)) : [];
  const unacknowledged = [];
  const acknowledged = [];
  const matchedEntries = new Set();
  // An acknowledgement is only honoured once package.json has moved on from the baseline tag's
  // version; otherwise a stale entry from the previous release would silently accept new risks.
  // `baselineVersion` undefined means "not checked" (pure-function callers); main() always supplies it.
  const versionNotBumped = baselineVersion !== undefined && baselineVersion === version;
  for (const v of riskyFindings) {
    const named = entries.filter((e) => e.name === v.name);
    named.forEach((e) => matchedEntries.add(e));
    if (versionNotBumped) {
      unacknowledged.push({
        ...v,
        message: `${v.message} (package.json version ${version} equals the baseline tag version: bump the version before acknowledging)`,
      });
      continue;
    }
    const good = named.find(
      (e) => version !== undefined && e.acknowledgedIn === version && typeof e.reason === "string" && e.reason.trim() !== "",
    );
    if (good) {
      acknowledged.push({ ...v, acknowledgement: good });
    } else if (named.length > 0) {
      const why = named
        .map((e) =>
          e.acknowledgedIn !== version
            ? `acknowledged in ${JSON.stringify(e.acknowledgedIn)}, not ${JSON.stringify(version)}`
            : "reason is empty",
        )
        .join("; ");
      unacknowledged.push({ ...v, message: `${v.message} (acknowledgement not accepted: ${why})` });
    } else {
      unacknowledged.push(v);
    }
  }
  const hardNames = new Set(hardFindings.map((h) => h.name));
  const notices = [];
  for (const e of entries) {
    if (matchedEntries.has(e)) continue;
    notices.push(
      hardNames.has(e.name)
        ? `acknowledgement for ${JSON.stringify(e.name)} ignored: it names a HARD finding, which can never be acknowledged`
        : `acknowledgement for ${JSON.stringify(e.name)} (acknowledgedIn ${JSON.stringify(e.acknowledgedIn)}) matches no RISKY finding; remove stale entries`,
    );
  }
  return { unacknowledged, acknowledged, notices };
}

/**
 * Compare two file maps ({ "src/schemas/x.schema.json": parsedJson, ... }). Files only in
 * `current` are additions and pass. Returns:
 *   breaking      HARD findings not excused by a matured deprecation
 *   allowed       HARD removals excused by a matured deprecation
 *   risky         RISKY findings not acknowledged for `version`
 *   acknowledged  RISKY findings accepted by an acknowledgement
 *   notices       stale or ignored acknowledgement entries
 */
export function compareTrees(
  baselineFiles,
  currentFiles,
  deprecations,
  today,
  acknowledgements = [],
  version = undefined,
  baselineVersion = undefined,
) {
  const all = [];
  for (const path of Object.keys(baselineFiles).sort()) {
    const file = path.split("/").pop();
    const isSchema = path.startsWith(`${SCHEMA_DIR}/`);
    if (!(path in currentFiles)) {
      all.push(hard(`${file}#`, "file-removed", `file removed: ${path}`, true));
      continue;
    }
    const found = isSchema
      ? diffSchema(file, baselineFiles[path], currentFiles[path])
      : diffConstants(file, baselineFiles[path], currentFiles[path]);
    all.push(...found);
  }
  const hardFindings = all.filter((f) => f.tier === "hard");
  const riskyFindings = all.filter((f) => f.tier === "risky");
  const { breaking, allowed, problems } = applyDeprecations(hardFindings, deprecations, today);
  const { unacknowledged, acknowledged, notices } = applyAcknowledgements(
    riskyFindings,
    acknowledgements,
    version,
    hardFindings,
    baselineVersion,
  );
  return { breaking, allowed, risky: unacknowledged, acknowledged, notices, problems };
}

/** The package.json version at the baseline tag. `run(args)` executes git; throws when unreadable. */
export function readBaselineVersion(run, tag) {
  const version = JSON.parse(run(["show", `${tag}:package.json`])).version;
  if (typeof version !== "string" || version === "") throw new Error(`${tag}:package.json has no version`);
  return version;
}

/**
 * Choose the baseline tag. `run(args)` executes git and returns stdout. The latest tag reachable
 * from HEAD, excluding every tag that points at HEAD (so a tagged release is not compared with
 * itself). Returns { tag, excluded }; tag is "" when there is none.
 */
export function chooseBaseline(run) {
  let excluded = [];
  try {
    excluded = run(["tag", "--points-at", "HEAD"])
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t !== "");
  } catch {
    excluded = [];
  }
  let tag = "";
  try {
    tag = run(["describe", "--tags", "--abbrev=0", ...excluded.flatMap((t) => ["--exclude", t])]).trim();
  } catch {
    tag = "";
  }
  return { tag, excluded };
}

// ── Git and filesystem plumbing ───────────────────────────────────────────────

const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const isContractFile = (path) =>
  (path.startsWith(`${SCHEMA_DIR}/`) && path.endsWith(".schema.json")) ||
  (path.startsWith(`${CONSTANTS_DIR}/`) && path.endsWith(".json"));

function readBaseline(tag) {
  const listed = git(["ls-tree", "-r", "--name-only", tag, "--", SCHEMA_DIR, CONSTANTS_DIR])
    .split("\n")
    .map((p) => p.trim())
    .filter(isContractFile);
  const files = {};
  for (const path of listed) files[path] = JSON.parse(git(["show", `${tag}:${path}`]));
  let deprecations = [];
  try {
    deprecations = JSON.parse(git(["show", `${tag}:deprecations.json`]));
  } catch {
    deprecations = []; // absent at the baseline tag: nothing is deprecated
  }
  return { files, deprecations };
}

function readWorkingTree() {
  const files = {};
  for (const dir of [SCHEMA_DIR, CONSTANTS_DIR]) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      const path = `${dir}/${name}`;
      if (isContractFile(path)) files[path] = JSON.parse(readFileSync(join(abs, name), "utf8"));
    }
  }
  return files;
}

// Acknowledgements are read from the WORKING TREE, never from the baseline tag.
function readAcknowledgements() {
  const abs = join(ROOT, ACK_FILE);
  if (!existsSync(abs)) return [];
  const parsed = JSON.parse(readFileSync(abs, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${ACK_FILE} must be a JSON array`);
  return parsed;
}

function main() {
  const { tag, excluded } = chooseBaseline(git);
  if (tag === "") {
    console.error("NO BASELINE TAG: compat check did not run");
    return 2;
  }
  console.log(`baseline tag: ${tag} (excluded tags pointing at HEAD: ${excluded.length > 0 ? excluded.join(", ") : "none"})`);

  let baseline;
  try {
    baseline = readBaseline(tag);
  } catch (err) {
    console.error(`COMPAT CHECK DID NOT RUN: could not read baseline ${tag}: ${err.message}`);
    return 2;
  }

  let acknowledgements;
  let version;
  try {
    acknowledgements = readAcknowledgements();
    version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  } catch (err) {
    console.error(`COMPAT CHECK DID NOT RUN: could not read ${ACK_FILE} or package.json: ${err.message}`);
    return 2;
  }

  let baselineVersion;
  try {
    baselineVersion = readBaselineVersion(git, tag);
  } catch (err) {
    console.error(`COMPAT CHECK DID NOT RUN: could not read the package.json version at ${tag}: ${err.message}`);
    return 2;
  }

  const today = new Date().toISOString().slice(0, 10);
  const { breaking, allowed, risky: unacknowledged, acknowledged, notices, problems } = compareTrees(
    baseline.files,
    readWorkingTree(),
    baseline.deprecations,
    today,
    acknowledgements,
    version,
    baselineVersion,
  );

  for (const a of allowed) console.log(`allowed (deprecation window over): [HARD ${a.rule}] ${a.name} - ${a.message}`);
  for (const a of acknowledged) {
    console.log(`acknowledged in ${version}: [RISKY ${a.rule}] ${a.name} - ${a.message} - reason: ${a.acknowledgement.reason}`);
  }
  for (const n of notices) console.log(`NOTICE: ${n}`);

  if (breaking.length > 0) {
    console.error(`BREAKING (HARD) changes against ${tag}:`);
    for (const b of breaking) console.error(`  [HARD ${b.rule}] ${b.name} - ${b.message}`);
  }
  if (unacknowledged.length > 0) {
    console.error(`RISKY changes against ${tag} (add a compat-acknowledgements.json entry for ${version} to accept):`);
    for (const r of unacknowledged) console.error(`  [RISKY ${r.rule}] ${r.name} - ${r.message}`);
  }
  if (problems.length > 0) {
    console.error(`INVALID deprecations.json at ${tag}:`);
    for (const p of problems) console.error(`  ${p}`);
  }
  if (breaking.length > 0 || unacknowledged.length > 0 || problems.length > 0) return 1;

  console.log(`compat OK: no unacknowledged changes against ${tag} (${Object.keys(baseline.files).length} files compared)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
