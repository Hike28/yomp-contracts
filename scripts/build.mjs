// yomp-contracts build — one authored source → generated TS + Kotlin outputs.
//
//   src/schemas/*.schema.json   --quicktype-->  build/ts + build/kotlin (shapes)
//   src/constants/community.json --codegen-->   build/ts + build/kotlin (constants)
//
// Kotlin is EMITTED only here; it is compiled later when yomp-android's :shared
// module consumes this repo as a submodule (mirrors how yomp-tokens works).
//
// Run: npm run build
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KOTLIN_PACKAGE = "dog.yomp.contracts";

const TS_DIR = join(ROOT, "build", "ts");
const KT_DIR = join(ROOT, "build", "kotlin");
// Split generated Kotlin by KMP source-set safety: common/ = pure-stdlib contracts
// (wire into commonMain), android/ = Firebase/platform-bound (androidMain only). An
// ios/ dir can join later. Mirrors how yomp-android's :shared consumes this.
const KT_COMMON_DIR = join(KT_DIR, "common");
const KT_ANDROID_DIR = join(KT_DIR, "android");
mkdirSync(TS_DIR, { recursive: true });
mkdirSync(KT_COMMON_DIR, { recursive: true });
mkdirSync(KT_ANDROID_DIR, { recursive: true });

const SCHEMA = join(ROOT, "src", "schemas", "place-stats.schema.json");

// ── 1. Shapes via quicktype ────────────────────────────────────────────────
function quicktype(args) {
  execSync(`npx --yes quicktype ${args}`, { stdio: ["ignore", "pipe", "inherit"], cwd: ROOT });
}

const tsOut = join(TS_DIR, "place-stats.ts");
const ktOut = join(KT_ANDROID_DIR, "PlaceStats.kt");

quicktype(`--src-lang schema --lang ts --just-types --src "${SCHEMA}" -o "${tsOut}"`);
quicktype(`--src-lang schema --lang kotlin --framework just-types --package ${KOTLIN_PACKAGE} --src "${SCHEMA}" -o "${ktOut}"`);

// ── 2. Timestamp alias swap ─────────────────────────────────────────────────
// lastUpdated is a Firestore server Timestamp. quicktype emits an opaque object
// type from the schema's `$ref: Timestamp`; we replace that with the idiomatic
// per-platform alias (faithful to how the Firestore SDK deserialises it).
function aliasTimestampTs(file) {
  let s = readFileSync(file, "utf8");
  // Force the field REQUIRED (drop quicktype's `?`) and to the full write/read/null
  // union: Timestamp = reads, FieldValue = the serverTimestamp() write moment, null =
  // web's `?? null` / cleared. This is a TS-only narrowing — the shared schema keeps
  // lastUpdated optional (legacy docs) and Kotlin stays nullable `Timestamp?`.
  s = s.replace(/\blastUpdated\??\s*:\s*[^;\n]+/g, "lastUpdated: Timestamp | FieldValue | null");
  // Drop any generated `Timestamp` interface/type declaration.
  s = s.replace(/export interface Timestamp \{[\s\S]*?\n\}\n?/g, "");
  s = s.replace(/export type Timestamp = [^;]+;\n?/g, "");
  // Bind Timestamp + FieldValue to the real Firebase types via a type-only import
  // (parity with the Kotlin Timestamp alias; FieldValue has no Kotlin data-class form).
  s = `import type { FieldValue, Timestamp } from "firebase/firestore";\n\n${s}`;
  writeFileSync(file, s);
}

function aliasTimestampKotlin(file) {
  let s = readFileSync(file, "utf8");
  // Rewrite the whole lastUpdated type to the FQ `com.google.firebase.Timestamp?`
  // (quicktype inlines the opaque object as `Map<String, Any?>?`, whose embedded comma
  // defeats a simple token match — so match lazily to end-of-line, preserving any
  // ` = null`/comma). FQN inline avoids a per-file `typealias Timestamp` that would
  // collide (Redeclaration) once android/ files co-compile into one source set.
  s = s.replace(/(val lastUpdated:\s*).+?(\s*=\s*null)?(,)?(\r?\n)/g, "$1com.google.firebase.Timestamp?$2$3$4");
  // Drop any generated Timestamp class/typealias (the field now carries the FQN inline,
  // so no top-level alias is emitted — nothing left to collide on co-compile).
  s = s.replace(/(?:data )?class Timestamp \([\s\S]*?\)\n?/g, "");
  s = s.replace(/typealias Timestamp = .*\n?/g, "");
  writeFileSync(file, s);
}

// Narrow the TS attributeCounts map keys to AttributeKey (web parity). quicktype
// emits an open string-index signature from the schema's additionalProperties; rewrite
// it to Partial<Record<AttributeKey, AttributeCount>>. TS-only — Kotlin keeps
// Map<String, AttributeCount>? (no enum-keyed-map equivalent in the data class).
function narrowAttributeCountsTs(file) {
  let s = readFileSync(file, "utf8");
  s = s.replace(
    /(\battributeCounts\??\s*:\s*)\{\s*\[key:\s*string\]\s*:\s*AttributeCount\s*\}/g,
    "$1Partial<Record<AttributeKey, AttributeCount>>",
  );
  // Bind AttributeKey from the generated constants (sibling file in build/ts).
  s = `import type { AttributeKey } from "./constants";\n${s}`;
  writeFileSync(file, s);
}

aliasTimestampTs(tsOut);
narrowAttributeCountsTs(tsOut);
aliasTimestampKotlin(ktOut);

// ── 2b. User record shape via quicktype ─────────────────────────────────────
// The user document (collection `users`). It carries four Firestore server Timestamps,
// so its Kotlin output is Firebase-bound → android/. Same per-platform Timestamp aliasing
// as PlaceStats.lastUpdated, but the user record is a PARTIAL PATCH: every field stays
// OPTIONAL (we do NOT force-required), so the helpers below preserve the `?`/`= null`.
const USER_SCHEMA = join(ROOT, "src", "schemas", "user-record.schema.json");
const userTsOut = join(TS_DIR, "user-record.ts");
const userKtOut = join(KT_ANDROID_DIR, "UserRecord.kt");
const USER_TIMESTAMP_FIELDS = ["createdAt", "lastSignIn", "updatedAt", "onboardingCompletedAt"];

quicktype(`--src-lang schema --lang ts --just-types --src "${USER_SCHEMA}" -o "${userTsOut}"`);
// --acronym-style original: keep field names VERBATIM from the schema/Firestore keys
// (uid, photoURL, seenPlaceIds, avatarUrl). quicktype's default style would uppercase
// acronyms (seenPlaceIDS, avatarURL) in Kotlin only, drifting from the TS output and the
// actual Firestore keys — the precise drift this repo exists to prevent.
quicktype(`--src-lang schema --lang kotlin --framework just-types --acronym-style original --package ${KOTLIN_PACKAGE} --src "${USER_SCHEMA}" -o "${userKtOut}"`);

// Generalised Timestamp aliasing (multiple fields, optionality PRESERVED). Mirrors the
// PlaceStats helpers' per-platform binding but never drops the optional marker.
function aliasTimestampsTs(file, fields) {
  let s = readFileSync(file, "utf8");
  for (const f of fields) {
    // Keep the captured `?` ($1) so the field stays optional, unlike PlaceStats.lastUpdated.
    s = s.replace(new RegExp(`\\b${f}(\\??)\\s*:\\s*[^;\\n]+`, "g"), `${f}$1: Timestamp | FieldValue | null`);
  }
  s = s.replace(/export interface Timestamp \{[\s\S]*?\n\}\n?/g, "");
  s = s.replace(/export type Timestamp = [^;]+;\n?/g, "");
  s = `import type { FieldValue, Timestamp } from "firebase/firestore";\n\n${s}`;
  writeFileSync(file, s);
}

function aliasTimestampsKotlin(file, fields) {
  let s = readFileSync(file, "utf8");
  for (const f of fields) {
    // Lazy match to end-of-line preserves any ` = null`/comma (quicktype inlines the opaque
    // Timestamp object as `Map<String, Any?>?`, whose embedded comma defeats a token match).
    // FQN inline (no top-level alias) so multiple android/ files never redeclare Timestamp.
    s = s.replace(new RegExp(`(val ${f}:\\s*).+?(\\s*=\\s*null)?(,)?(\\r?\\n)`, "g"), "$1com.google.firebase.Timestamp?$2$3$4");
  }
  s = s.replace(/(?:data )?class Timestamp \([\s\S]*?\)\n?/g, "");
  s = s.replace(/typealias Timestamp = .*\n?/g, "");
  writeFileSync(file, s);
}

aliasTimestampsTs(userTsOut, USER_TIMESTAMP_FIELDS);
aliasTimestampsKotlin(userKtOut, USER_TIMESTAMP_FIELDS);

// ── 3. Constants codegen ────────────────────────────────────────────────────
const community = JSON.parse(readFileSync(join(ROOT, "src", "constants", "community.json"), "utf8"));
const { status, attributeKeys, thresholds, safeIdPattern } = community;

const tsList = (arr) => arr.map((v) => JSON.stringify(v)).join(", ");
const ktList = (arr) => arr.map((v) => JSON.stringify(v)).join(", ");

const tsConstants = `// AUTO-GENERATED by scripts/build.mjs from src/constants/community.json. Do not edit.

export const STATUS = [${tsList(status)}] as const;
export type Status = (typeof STATUS)[number];

export const ATTRIBUTE_KEYS = [${tsList(attributeKeys)}] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

export const MIN_COMMUNITY_VOTES = ${thresholds.MIN_COMMUNITY_VOTES};
export const HIGH_CONFIDENCE_VOTES = ${thresholds.HIGH_CONFIDENCE_VOTES};

/** Sanitises a raw placeId into a Firestore-safe doc id (matches the web app's safeId). */
export const SAFE_ID_PATTERN = /${safeIdPattern}/g;
export function safeId(id: string): string {
  return id.replace(SAFE_ID_PATTERN, "_");
}
`;
writeFileSync(join(TS_DIR, "constants.ts"), tsConstants);

const ktConstants = `// AUTO-GENERATED by scripts/build.mjs from src/constants/community.json. Do not edit.
package ${KOTLIN_PACKAGE}

object Community {
    val STATUS: List<String> = listOf(${ktList(status)})
    val ATTRIBUTE_KEYS: List<String> = listOf(${ktList(attributeKeys)})

    const val MIN_COMMUNITY_VOTES: Int = ${thresholds.MIN_COMMUNITY_VOTES}
    const val HIGH_CONFIDENCE_VOTES: Int = ${thresholds.HIGH_CONFIDENCE_VOTES}

    /** Sanitises a raw placeId into a Firestore-safe doc id (matches the web app's safeId). */
    val SAFE_ID_REGEX: Regex = Regex(${JSON.stringify(safeIdPattern)})

    fun safeId(id: String): String = id.replace(SAFE_ID_REGEX, "_")
}
`;
writeFileSync(join(KT_COMMON_DIR, "Community.kt"), ktConstants);

// ── 4. Map constants codegen ────────────────────────────────────────────────
// Map/cluster constants live in their own source (src/constants/map.json) for clean
// separation from community.json. Emitted as STRUCTURED, typed contracts — a TS
// `as const` + interfaces, and Kotlin data classes — never a JSON blob. Literals are
// DERIVED by mapping over the source arrays, not hardcoded.
const map = JSON.parse(readFileSync(join(ROOT, "src", "constants", "map.json"), "utf8"));
const { mapCategoryKeys, clusterPolicy } = map;

const tsRadius = (r) => `{ minZoom: ${r.minZoom}, radius: ${r.radius} }`;
const tsBucket = (b) => `{ minCount: ${b.minCount}, outer: ${b.outer}, inner: ${b.inner}, font: ${b.font} }`;
const ktRadius = (r) => `ClusterRadiusRule(${r.minZoom}, ${r.radius})`;
const ktBucket = (b) => `ClusterCountBucket(${b.minCount}, ${b.outer}, ${b.inner}, ${b.font})`;

const tsMap = `
export const MAP_CATEGORY_KEYS = [${tsList(mapCategoryKeys)}] as const;
export type MapCategoryKey = (typeof MAP_CATEGORY_KEYS)[number];

export interface ClusterRadiusRule { minZoom: number; radius: number; }
export interface ClusterCountBucket { minCount: number; outer: number; inner: number; font: number; }
export interface ClusterPolicy {
  maxClusterRadiusByZoom: readonly ClusterRadiusRule[];
  countBuckets: readonly ClusterCountBucket[];
  spiderfyOnMaxZoom: boolean;
  clusterPerCategory: boolean;
}
export const CLUSTER_POLICY: ClusterPolicy = {
  maxClusterRadiusByZoom: [ ${clusterPolicy.maxClusterRadiusByZoom.map(tsRadius).join(", ")} ],
  countBuckets: [ ${clusterPolicy.countBuckets.map(tsBucket).join(", ")} ],
  spiderfyOnMaxZoom: ${clusterPolicy.spiderfyOnMaxZoom},
  clusterPerCategory: ${clusterPolicy.clusterPerCategory},
};
`;
appendFileSync(join(TS_DIR, "constants.ts"), tsMap);

const ktMap = `// AUTO-GENERATED by scripts/build.mjs from src/constants/map.json. Do not edit.
package ${KOTLIN_PACKAGE}

val MAP_CATEGORY_KEYS: List<String> = listOf(${ktList(mapCategoryKeys)})

data class ClusterRadiusRule(val minZoom: Int, val radius: Int)
data class ClusterCountBucket(val minCount: Int, val outer: Int, val inner: Int, val font: Int)
data class ClusterPolicy(
    val maxClusterRadiusByZoom: List<ClusterRadiusRule>,
    val countBuckets: List<ClusterCountBucket>,
    val spiderfyOnMaxZoom: Boolean,
    val clusterPerCategory: Boolean,
)

val CLUSTER_POLICY: ClusterPolicy = ClusterPolicy(
    maxClusterRadiusByZoom = listOf(${clusterPolicy.maxClusterRadiusByZoom.map(ktRadius).join(", ")}),
    countBuckets = listOf(${clusterPolicy.countBuckets.map(ktBucket).join(", ")}),
    spiderfyOnMaxZoom = ${clusterPolicy.spiderfyOnMaxZoom},
    clusterPerCategory = ${clusterPolicy.clusterPerCategory},
)
`;
writeFileSync(join(KT_COMMON_DIR, "Map.kt"), ktMap);

// ── 5. Account constants codegen ─────────────────────────────────────────────
// Keys-only sets for the user record's app-validated string fields. Authored as plain
// String lists (NEVER enums) so consumers can filter unknown values on read — out-of-set
// data can never crash a typed enum. Pure stdlib → routed to common/ (commonMain-safe).
const account = JSON.parse(readFileSync(join(ROOT, "src", "constants", "account.json"), "utf8"));
const { categoryKeys, selectableCategoryKeys, authProviders, themeModes } = account;

// SELECTABLE_CATEGORY_KEYS (the user-facing subset, in display order) MUST be drawn from the full
// CATEGORY_KEYS vocabulary. A stray value aborts the build (RED) rather than emitting a silently
// drifted contract — the single cross-language guard (Kotlin has no subset-type form).
const straySelectable = selectableCategoryKeys.filter((c) => !categoryKeys.includes(c));
if (straySelectable.length > 0) {
  throw new Error(
    `account.json: selectableCategoryKeys contains value(s) not in categoryKeys: ${JSON.stringify(straySelectable)}. ` +
      "SELECTABLE_CATEGORY_KEYS must be a subset of CATEGORY_KEYS.",
  );
}

const tsAccount = `
export const CATEGORY_KEYS = [${tsList(categoryKeys)}] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

/** The currently user-facing category subset, in display order (⊆ CATEGORY_KEYS; see account.json). */
export const SELECTABLE_CATEGORY_KEYS = [${tsList(selectableCategoryKeys)}] as const;
export type SelectableCategoryKey = (typeof SELECTABLE_CATEGORY_KEYS)[number];

export const AUTH_PROVIDERS = [${tsList(authProviders)}] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const THEME_MODES = [${tsList(themeModes)}] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
`;
appendFileSync(join(TS_DIR, "constants.ts"), tsAccount);

const ktAccount = `// AUTO-GENERATED by scripts/build.mjs from src/constants/account.json. Do not edit.
package ${KOTLIN_PACKAGE}

val CATEGORY_KEYS: List<String> = listOf(${ktList(categoryKeys)})
val SELECTABLE_CATEGORY_KEYS: List<String> = listOf(${ktList(selectableCategoryKeys)})
val AUTH_PROVIDERS: List<String> = listOf(${ktList(authProviders)})
val THEME_MODES: List<String> = listOf(${ktList(themeModes)})
`;
writeFileSync(join(KT_COMMON_DIR, "Account.kt"), ktAccount);

// ── 6. User-record key allowlist codegen ─────────────────────────────────────
// USER_KEYS = the top-level property NAMES of user-record.schema.json, DERIVED from
// the schema (never hand-typed) so a future field change propagates automatically.
// The doc-key allowlist consumers assert client writes against (yomp-android Q1
// conformance). Pure stdlib → common/ (commonMain-safe); its own file + header per
// the one-source-per-file Kotlin convention (source is the SCHEMA, not account.json).
const userSchema = JSON.parse(readFileSync(USER_SCHEMA, "utf8"));
const userKeys = Object.keys(userSchema.properties);

const tsUserKeys = `
export const USER_KEYS = [${tsList(userKeys)}] as const;
export type UserKey = (typeof USER_KEYS)[number];
`;
appendFileSync(join(TS_DIR, "constants.ts"), tsUserKeys);

const ktUserKeys = `// AUTO-GENERATED by scripts/build.mjs from src/schemas/user-record.schema.json. Do not edit.
package ${KOTLIN_PACKAGE}

val USER_KEYS: List<String> = listOf(${ktList(userKeys)})
`;
writeFileSync(join(KT_COMMON_DIR, "UserKeys.kt"), ktUserKeys);

console.log("✔ build complete — build/ts + build/kotlin");
