// yomp-contracts compatibility check — additive changes only.
//
//   node scripts/check-compat.mjs        (npm run check:compat)
//
// Baseline = the latest tag reachable from HEAD (`git describe --tags --abbrev=0`). Every
// src/schemas/*.schema.json and src/constants/*.json at that tag is compared with the working
// tree. Additions pass. These are BREAKING:
//
//   schemas    schema file removed · property removed · `type` changed or narrowed ·
//              enum value removed · property newly added to `required` ·
//              `additionalProperties` changed from true/absent to false
//   constants  any key path removed · any string member of an array removed
//
// A removal (file, property, enum value, constant key or array member) is tolerated only when the
// BASELINE tag's deprecations.json lists it:
//   { "name": "<file>#<pointer>", "deprecatedIn": "<tag>", "removeAfter": "YYYY-MM-DD" }
// and removeAfter is on or before today. Type narrowing, new required fields and
// additionalProperties:false can never be deprecated away; they need a new major contract.
//
// Exit codes: 0 compatible · 1 BREAKING · 2 check did not run (no baseline tag, or git failed).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_DIR = "src/schemas";
const CONSTANTS_DIR = "src/constants";

// ── Pure diff ─────────────────────────────────────────────────────────────────

// A violation: { name, rule, message, removal }. `name` is the deprecation key.
const violation = (name, rule, message, removal = false) => ({ name, rule, message, removal });

const typeSet = (t) => (t === undefined ? null : new Set(Array.isArray(t) ? t : [t]));
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Compare two schema nodes at `pointer`. Walks properties, items and definitions.
function diffNode(file, pointer, oldNode, newNode, out) {
  if (!isObject(oldNode) || !isObject(newNode)) return;
  const at = (suffix) => `${file}#${pointer}${suffix}`;

  const oldTypes = typeSet(oldNode.type);
  const newTypes = typeSet(newNode.type);
  if (oldTypes && newTypes) {
    // Every type the baseline accepted must still be accepted. (integer is NOT treated as a
    // subset of number: the generated Kotlin type changes, so that is a real break.)
    const lost = [...oldTypes].filter((t) => !newTypes.has(t));
    if (lost.length > 0) {
      out.push(
        violation(
          at("/type"),
          "type-changed",
          `type changed or narrowed: ${JSON.stringify(oldNode.type)} -> ${JSON.stringify(newNode.type)}`,
        ),
      );
    }
  }

  if (Array.isArray(oldNode.enum) && Array.isArray(newNode.enum)) {
    for (const v of oldNode.enum) {
      if (!newNode.enum.some((n) => JSON.stringify(n) === JSON.stringify(v))) {
        out.push(
          violation(at(`/enum/${String(v)}`), "enum-value-removed", `enum value removed: ${JSON.stringify(v)}`, true),
        );
      }
    }
  }

  const oldRequired = Array.isArray(oldNode.required) ? oldNode.required : [];
  const newRequired = Array.isArray(newNode.required) ? newNode.required : [];
  for (const r of newRequired) {
    if (!oldRequired.includes(r)) {
      out.push(violation(at(`/required/${r}`), "required-added", `property newly required: "${r}"`));
    }
  }

  if (oldNode.additionalProperties !== false && newNode.additionalProperties === false) {
    out.push(
      violation(
        at("/additionalProperties"),
        "additional-properties-closed",
        "additionalProperties changed from true/absent to false",
      ),
    );
  }

  const oldProps = isObject(oldNode.properties) ? oldNode.properties : {};
  const newProps = isObject(newNode.properties) ? newNode.properties : {};
  for (const key of Object.keys(oldProps)) {
    if (!(key in newProps)) {
      out.push(violation(at(`/properties/${key}`), "property-removed", `property removed: "${key}"`, true));
    } else {
      diffNode(file, `${pointer}/properties/${key}`, oldProps[key], newProps[key], out);
    }
  }

  if (isObject(oldNode.items) && isObject(newNode.items)) {
    diffNode(file, `${pointer}/items`, oldNode.items, newNode.items, out);
  }

  for (const bag of ["definitions", "$defs"]) {
    const oldDefs = isObject(oldNode[bag]) ? oldNode[bag] : {};
    const newDefs = isObject(newNode[bag]) ? newNode[bag] : {};
    for (const key of Object.keys(oldDefs)) {
      if (!(key in newDefs)) {
        out.push(violation(at(`/${bag}/${key}`), "definition-removed", `definition removed: "${key}"`, true));
      } else {
        diffNode(file, `${pointer}/${bag}/${key}`, oldDefs[key], newDefs[key], out);
      }
    }
  }
}

/** Violations between two parsed JSON Schemas (file is the bare file name). */
export function diffSchema(file, oldSchema, newSchema) {
  const out = [];
  diffNode(file, "", oldSchema, newSchema, out);
  return out;
}

// Constants: a removed key path, or a removed string member of an array.
function diffConstantNode(file, path, oldValue, newValue, out) {
  if (isObject(oldValue)) {
    for (const key of Object.keys(oldValue)) {
      const here = path === "" ? key : `${path}.${key}`;
      if (!isObject(newValue) || !(key in newValue)) {
        out.push(violation(`${file}#${here}`, "constant-removed", `constant key removed: ${here}`, true));
      } else {
        diffConstantNode(file, here, oldValue[key], newValue[key], out);
      }
    }
  } else if (Array.isArray(oldValue)) {
    for (const member of oldValue) {
      if (typeof member !== "string") continue;
      if (!Array.isArray(newValue) || !newValue.includes(member)) {
        out.push(
          violation(
            `${file}#${path}[${member}]`,
            "constant-member-removed",
            `array member removed from ${path}: ${JSON.stringify(member)}`,
            true,
          ),
        );
      }
    }
  }
}

/** Violations between two parsed constants files. */
export function diffConstants(file, oldValue, newValue) {
  const out = [];
  diffConstantNode(file, "", oldValue, newValue, out);
  return out;
}

/**
 * Drop removal violations covered by a matured deprecation entry. Returns
 * { breaking, allowed }; a listed-but-not-yet-matured removal stays breaking with a clear message.
 */
export function applyDeprecations(violations, deprecations, today) {
  const entries = Array.isArray(deprecations) ? deprecations : [];
  const breaking = [];
  const allowed = [];
  for (const v of violations) {
    const entry = v.removal ? entries.find((e) => e && e.name === v.name) : undefined;
    if (!entry) {
      breaking.push(v);
    } else if (typeof entry.removeAfter === "string" && entry.removeAfter <= today) {
      allowed.push({ ...v, deprecation: entry });
    } else {
      breaking.push({
        ...v,
        message: `${v.message} (deprecated in ${entry.deprecatedIn}, but removeAfter ${entry.removeAfter} is after ${today})`,
      });
    }
  }
  return { breaking, allowed };
}

/**
 * Compare two file maps ({ "src/schemas/x.schema.json": parsedJson, ... }).
 * Files only in `current` are additions and pass.
 */
export function compareTrees(baselineFiles, currentFiles, deprecations, today) {
  const all = [];
  for (const path of Object.keys(baselineFiles).sort()) {
    const file = path.split("/").pop();
    const isSchema = path.startsWith(`${SCHEMA_DIR}/`);
    if (!(path in currentFiles)) {
      all.push(violation(`${file}#`, "file-removed", `file removed: ${path}`, true));
      continue;
    }
    const found = isSchema
      ? diffSchema(file, baselineFiles[path], currentFiles[path])
      : diffConstants(file, baselineFiles[path], currentFiles[path]);
    all.push(...found);
  }
  return applyDeprecations(all, deprecations, today);
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

function main() {
  let tag;
  try {
    tag = git(["describe", "--tags", "--abbrev=0"]).trim();
  } catch {
    tag = "";
  }
  if (tag === "") {
    console.error("NO BASELINE TAG: compat check did not run");
    return 2;
  }

  let baseline;
  try {
    baseline = readBaseline(tag);
  } catch (err) {
    console.error(`COMPAT CHECK DID NOT RUN: could not read baseline ${tag}: ${err.message}`);
    return 2;
  }

  const today = new Date().toISOString().slice(0, 10);
  const { breaking, allowed } = compareTrees(baseline.files, readWorkingTree(), baseline.deprecations, today);

  for (const a of allowed) {
    console.log(`allowed (deprecation window over): ${a.name} - ${a.message}`);
  }
  if (breaking.length > 0) {
    console.error(`BREAKING changes against ${tag}:`);
    for (const b of breaking) console.error(`  [${b.rule}] ${b.name} - ${b.message}`);
    return 1;
  }
  console.log(`compat OK: no breaking changes against ${tag} (${Object.keys(baseline.files).length} files compared)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
