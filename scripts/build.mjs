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

// ── Saved-place description guard (fail-fast, BEFORE any file is written) ──────
// saved-place.schema.json is the AUTHORED source for the SAVED_PLACE_KEYS semantics (emitted as doc
// comments in §8). Validate every property's `description` HERE, before §1 writes anything, so a
// missing/empty description — or one containing the comment terminator, which would break the
// generated KDoc AND JSDoc — fails the build loudly naming the property and emits NOTHING: never a
// broken comment or `undefined` placeholder into a contract three platforms read. Fail; never strip.
const savedPlaceSchema = JSON.parse(readFileSync(join(ROOT, "src", "schemas", "saved-place.schema.json"), "utf8"));
const savedPlaceKeys = Object.keys(savedPlaceSchema.properties);
const SAVED_PLACE_COMMENT_TERMINATOR = "*/";
for (const k of savedPlaceKeys) {
  const d = savedPlaceSchema.properties[k].description;
  if (typeof d !== "string" || d.trim() === "") {
    throw new Error(`saved-place.schema.json: property "${k}" has a missing or empty description. Every saved_places key must carry its authored semantics.`);
  }
  if (d.includes(SAVED_PLACE_COMMENT_TERMINATOR)) {
    throw new Error(`saved-place.schema.json: property "${k}" description contains the comment terminator ${SAVED_PLACE_COMMENT_TERMINATOR}, which would break the generated KDoc/JSDoc. Reword it.`);
  }
}

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
const { status, attributeKeys, attributeLabels, thresholds, safeIdPattern } = community;
const { signalKeys, signalLimits, reportReasons, ownerEdit } = community;

const tsList = (arr) => arr.map((v) => JSON.stringify(v)).join(", ");
const ktList = (arr) => arr.map((v) => JSON.stringify(v)).join(", ");
// Label maps emit in ATTRIBUTE_KEYS (canonical) order so both outputs are stable.
const tsLabelEntries = attributeKeys.map((k) => `${k}: ${JSON.stringify(attributeLabels[k])}`).join(", ");
const ktLabelEntries = attributeKeys.map((k) => `${JSON.stringify(k)} to ${JSON.stringify(attributeLabels[k])}`).join(", ");

// ATTRIBUTE_LABELS must carry exactly one label per ATTRIBUTE_KEYS entry — no missing, no stray.
// Kotlin's Map has no compile-time key-completeness check, so this is the single cross-language
// guard: drift aborts the build (RED) rather than emitting a divergent contract (mirrors the
// selectableCategoryKeys ⊆ categoryKeys guard below).
const missingLabels = attributeKeys.filter((k) => !(k in attributeLabels));
const strayLabels = Object.keys(attributeLabels).filter((k) => !attributeKeys.includes(k));
if (missingLabels.length > 0 || strayLabels.length > 0) {
  throw new Error(
    `community.json: attributeLabels keys must match attributeKeys exactly ` +
      `(missing: ${JSON.stringify(missingLabels)}, stray: ${JSON.stringify(strayLabels)}).`,
  );
}

const tsConstants = `// AUTO-GENERATED by scripts/build.mjs from src/constants/community.json. Do not edit.

export const STATUS = [${tsList(status)}] as const;
export type Status = (typeof STATUS)[number];
// NATIVE BRIDGE: yomp-android's DogStatus.UNKNOWN ↔ this list's third wire value 'check'.
// The contract must not reference DogStatus (a native type) — documentation only, no code.

export const ATTRIBUTE_KEYS = [${tsList(attributeKeys)}] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

/** Canonical display label per ATTRIBUTE_KEYS entry (matches web OwnerBlock ATTRIBUTE_LABELS). */
export const ATTRIBUTE_LABELS: Record<AttributeKey, string> = { ${tsLabelEntries} };

export const MIN_COMMUNITY_VOTES = ${thresholds.MIN_COMMUNITY_VOTES};
export const HIGH_CONFIDENCE_VOTES = ${thresholds.HIGH_CONFIDENCE_VOTES};

/** Sanitises a raw placeId into a Firestore-safe doc id (matches the web app's safeId). */
export const SAFE_ID_PATTERN = /${safeIdPattern}/g;
export function safeId(id: string): string {
  return id.replace(SAFE_ID_PATTERN, "_");
}

// ── place_signals write-model — field names + numeric limits the deployed firestore.rules enforce ──
export const SIGNAL_KEYS = [${tsList(signalKeys)}] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

export const SIGNAL_PLACE_ID_MIN = ${signalLimits.PLACE_ID_MIN};
export const SIGNAL_PLACE_ID_MAX = ${signalLimits.PLACE_ID_MAX};
export const SIGNAL_PLACE_NAME_MIN = ${signalLimits.PLACE_NAME_MIN};
export const SIGNAL_PLACE_NAME_MAX = ${signalLimits.PLACE_NAME_MAX};
export const SIGNAL_PLACE_TYPE_MAX = ${signalLimits.PLACE_TYPE_MAX};
export const SIGNAL_RATING_MIN = ${signalLimits.RATING_MIN};
export const SIGNAL_RATING_MAX = ${signalLimits.RATING_MAX};
export const SIGNAL_REVIEW_MAX = ${signalLimits.REVIEW_MAX};

/**
 * Firestore doc id for a place_signals write: \`\${uid}_\${safeId(placeId)}\`.
 * SYNC — verified in yomp-next/src/lib/placeSignals.ts (saveSignal): the stored \`placeId\` FIELD is
 * ALSO the safeId form, so doc id and field share it and the rule \`signalId == uid+'_'+placeId\` holds.
 */
export function signalDocId(uid: string, placeId: string): string {
  return \`\${uid}_\${safeId(placeId)}\`;
}

// ── venue_reports write-model — reasons + deterministic composite doc id ──
export const REPORT_REASONS = [${tsList(reportReasons)}] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/**
 * Firestore doc id for a venue_reports write: \`\${uid}_\${safeId(placeId)}_\${reason}\`.
 * SYNC — yomp-next/src/components/place/ReportVenueSheet.tsx: the doc id uses the safeId form, but
 * that component writes the RAW placeId into the field; they coincide only because current Google/OSM
 * ids are already safeId-clean (see the firestore.rules venue_reports comment).
 */
export function reportDocId(uid: string, placeId: string, reason: string): string {
  return \`\${uid}_\${safeId(placeId)}_\${reason}\`;
}

// ── owner-published listing limits (firestore.rules venue_overrides) ──
export const WELCOME_MESSAGE_MAX = ${ownerEdit.WELCOME_MESSAGE_MAX};
export const OWNER_PHOTO_MAX = ${ownerEdit.OWNER_PHOTO_MAX};

/**
 * Rounds a raw average rating to nearest 0.1 (one decimal place).
 * SYNC — yomp-next/src/lib/placeStats.ts deriveAverageRating: mirrors \`Math.round(avg * 10) / 10\`.
 */
export function roundRating(rating: number): number {
  return Math.round(rating * 10) / 10;
}
`;
writeFileSync(join(TS_DIR, "constants.ts"), tsConstants);

const ktConstants = `// AUTO-GENERATED by scripts/build.mjs from src/constants/community.json. Do not edit.
package ${KOTLIN_PACKAGE}

object Community {
    val STATUS: List<String> = listOf(${ktList(status)})
    // NATIVE BRIDGE: yomp-android's DogStatus.UNKNOWN ↔ this list's third wire value 'check'.
    // The contract must not reference DogStatus (a native type) — documentation only, no code.
    val ATTRIBUTE_KEYS: List<String> = listOf(${ktList(attributeKeys)})

    /** Canonical display label per ATTRIBUTE_KEYS entry (matches web OwnerBlock ATTRIBUTE_LABELS). */
    val ATTRIBUTE_LABELS: Map<String, String> = mapOf(${ktLabelEntries})

    const val MIN_COMMUNITY_VOTES: Int = ${thresholds.MIN_COMMUNITY_VOTES}
    const val HIGH_CONFIDENCE_VOTES: Int = ${thresholds.HIGH_CONFIDENCE_VOTES}

    /** Sanitises a raw placeId into a Firestore-safe doc id (matches the web app's safeId). */
    val SAFE_ID_REGEX: Regex = Regex(${JSON.stringify(safeIdPattern)})

    fun safeId(id: String): String = id.replace(SAFE_ID_REGEX, "_")

    // ── place_signals write-model — field names + numeric limits the deployed firestore.rules enforce ──
    val SIGNAL_KEYS: List<String> = listOf(${ktList(signalKeys)})

    const val SIGNAL_PLACE_ID_MIN: Int = ${signalLimits.PLACE_ID_MIN}
    const val SIGNAL_PLACE_ID_MAX: Int = ${signalLimits.PLACE_ID_MAX}
    const val SIGNAL_PLACE_NAME_MIN: Int = ${signalLimits.PLACE_NAME_MIN}
    const val SIGNAL_PLACE_NAME_MAX: Int = ${signalLimits.PLACE_NAME_MAX}
    const val SIGNAL_PLACE_TYPE_MAX: Int = ${signalLimits.PLACE_TYPE_MAX}
    const val SIGNAL_RATING_MIN: Int = ${signalLimits.RATING_MIN}
    const val SIGNAL_RATING_MAX: Int = ${signalLimits.RATING_MAX}
    const val SIGNAL_REVIEW_MAX: Int = ${signalLimits.REVIEW_MAX}

    /**
     * Firestore doc id for a place_signals write: "\${uid}_\${safeId(placeId)}".
     * SYNC — verified in yomp-next/src/lib/placeSignals.ts (saveSignal): the stored placeId FIELD is
     * ALSO the safeId form, so doc id and field share it and the rule signalId == uid+'_'+placeId holds.
     */
    fun signalDocId(uid: String, placeId: String): String = "\${uid}_\${safeId(placeId)}"

    // ── venue_reports write-model — reasons + deterministic composite doc id ──
    val REPORT_REASONS: List<String> = listOf(${ktList(reportReasons)})

    /**
     * Firestore doc id for a venue_reports write: "\${uid}_\${safeId(placeId)}_\${reason}".
     * SYNC — yomp-next/src/components/place/ReportVenueSheet.tsx: the doc id uses the safeId form, but
     * that component writes the RAW placeId into the field; they coincide only because current Google/OSM
     * ids are already safeId-clean (see the firestore.rules venue_reports comment).
     */
    fun reportDocId(uid: String, placeId: String, reason: String): String = "\${uid}_\${safeId(placeId)}_\${reason}"

    // ── owner-published listing limits (firestore.rules venue_overrides) ──
    const val WELCOME_MESSAGE_MAX: Int = ${ownerEdit.WELCOME_MESSAGE_MAX}
    const val OWNER_PHOTO_MAX: Int = ${ownerEdit.OWNER_PHOTO_MAX}

    /**
     * Rounds a raw average rating to nearest 0.1 (one decimal place).
     * SYNC — yomp-next/src/lib/placeStats.ts deriveAverageRating: mirrors Math.round(avg * 10) / 10.
     */
    fun roundRating(rating: Double): Double = kotlin.math.round(rating * 10.0) / 10.0
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

// ── 7. Saved-places write-model constants ─────────────────────────────────────
// Personal bookmark data (collection `saved_places`) — deliberately a SEPARATE source from
// community.json (the community write-path) so a native dev finds it by domain, not buried among
// SIGNAL_*/REPORT_REASONS. Pure stdlib → common/ (its own SavedPlaces.kt object). savedPlaceDocId
// reuses safeId — TS locally in constants.ts, Kotlin via Community.safeId (same package + common
// source set) — never re-implemented.
const savedPlaces = JSON.parse(readFileSync(join(ROOT, "src", "constants", "saved-places.json"), "utf8"));
const { collection: savedPlacesCollection, limits: savedPlaceLimits } = savedPlaces;

const tsSavedPlaces = `
// ── saved_places write-model — field limits + doc id (deployed firestore.rules \`saved_places\`) ──
// Personal bookmark data (a user's own saved list), kept separate from the community write-path.
// Each *_MIN/_MAX caps the FIELD named in its comment, NOT the composite doc id — e.g.
// SAVED_PLACE_ID_MAX caps the \`placeId\` field (whose safeId form is the doc-id suffix).
export const SAVED_PLACES_COLLECTION = ${JSON.stringify(savedPlacesCollection)};

export const SAVED_PLACE_ID_MIN = ${savedPlaceLimits.ID_MIN}; // placeId field, min length
export const SAVED_PLACE_ID_MAX = ${savedPlaceLimits.ID_MAX}; // placeId field, max length
export const SAVED_PLACE_NAME_MIN = ${savedPlaceLimits.NAME_MIN}; // placeName field, min length
export const SAVED_PLACE_NAME_MAX = ${savedPlaceLimits.NAME_MAX}; // placeName field, max length
export const SAVED_PLACE_TYPE_MAX = ${savedPlaceLimits.TYPE_MAX}; // placeType field, max length
export const SAVED_PLACE_PHOTO_NAME_MAX = ${savedPlaceLimits.PHOTO_NAME_MAX}; // photoName field, max length
export const SAVED_PLACE_LAT_MIN = ${savedPlaceLimits.LAT_MIN}; // placeLat field
export const SAVED_PLACE_LAT_MAX = ${savedPlaceLimits.LAT_MAX}; // placeLat field
export const SAVED_PLACE_LNG_MIN = ${savedPlaceLimits.LNG_MIN}; // placeLng field
export const SAVED_PLACE_LNG_MAX = ${savedPlaceLimits.LNG_MAX}; // placeLng field
export const SAVED_PLACE_RATING_MIN = ${savedPlaceLimits.RATING_MIN}; // rating field
export const SAVED_PLACE_RATING_MAX = ${savedPlaceLimits.RATING_MAX}; // rating field

/**
 * Firestore doc id for a saved_places write: \`\${uid}_\${safeId(placeId)}\`.
 * Reuses safeId (above) — the deployed rule enforces \`saveId == uid + '_' + placeId\` where the
 * stored placeId FIELD is the safeId form, so the doc id and the field share the sanitised value.
 */
export function savedPlaceDocId(uid: string, placeId: string): string {
  return \`\${uid}_\${safeId(placeId)}\`;
}
`;
appendFileSync(join(TS_DIR, "constants.ts"), tsSavedPlaces);

const ktSavedPlaces = `// AUTO-GENERATED by scripts/build.mjs from src/constants/saved-places.json. Do not edit.
package ${KOTLIN_PACKAGE}

// saved_places write-model — field limits + doc id (deployed firestore.rules \`saved_places\`).
// Personal bookmark data (a user's own saved list), kept separate from the community write-path
// (Community.kt). Each *_MIN/_MAX caps the FIELD named in its comment, NOT the composite doc id.
object SavedPlaces {
    const val SAVED_PLACES_COLLECTION: String = ${JSON.stringify(savedPlacesCollection)}

    const val SAVED_PLACE_ID_MIN: Int = ${savedPlaceLimits.ID_MIN} // placeId field, min length
    const val SAVED_PLACE_ID_MAX: Int = ${savedPlaceLimits.ID_MAX} // placeId field, max length
    const val SAVED_PLACE_NAME_MIN: Int = ${savedPlaceLimits.NAME_MIN} // placeName field, min length
    const val SAVED_PLACE_NAME_MAX: Int = ${savedPlaceLimits.NAME_MAX} // placeName field, max length
    const val SAVED_PLACE_TYPE_MAX: Int = ${savedPlaceLimits.TYPE_MAX} // placeType field, max length
    const val SAVED_PLACE_PHOTO_NAME_MAX: Int = ${savedPlaceLimits.PHOTO_NAME_MAX} // photoName field, max length
    const val SAVED_PLACE_LAT_MIN: Int = ${savedPlaceLimits.LAT_MIN} // placeLat field
    const val SAVED_PLACE_LAT_MAX: Int = ${savedPlaceLimits.LAT_MAX} // placeLat field
    const val SAVED_PLACE_LNG_MIN: Int = ${savedPlaceLimits.LNG_MIN} // placeLng field
    const val SAVED_PLACE_LNG_MAX: Int = ${savedPlaceLimits.LNG_MAX} // placeLng field
    const val SAVED_PLACE_RATING_MIN: Int = ${savedPlaceLimits.RATING_MIN} // rating field
    const val SAVED_PLACE_RATING_MAX: Int = ${savedPlaceLimits.RATING_MAX} // rating field

    /**
     * Firestore doc id for a saved_places write: "\${uid}_\${safeId(placeId)}".
     * Reuses Community.safeId (same package + common source set) — safeId is NOT duplicated here.
     * The deployed rule enforces saveId == uid + '_' + placeId where the stored placeId FIELD is
     * the safeId form, so the doc id and the field share the sanitised value.
     */
    fun savedPlaceDocId(uid: String, placeId: String): String = "\${uid}_\${Community.safeId(placeId)}"
}
`;
writeFileSync(join(KT_COMMON_DIR, "SavedPlaces.kt"), ktSavedPlaces);

// ── 8. Saved-place key allowlist codegen ──────────────────────────────────────
// SAVED_PLACE_KEYS = the top-level property NAMES of saved-place.schema.json, DERIVED from the
// schema (never hand-typed) — the 9-key write ALLOWLIST (an allowlist, NOT a required-field list:
// photoName + rating are optional but permitted keys). Mirrors the USER_KEYS pattern; its own file
// per the one-source-per-file Kotlin convention (source is the SCHEMA, not saved-places.json).
// Rules-parity later collapses to hasOnly() == SAVED_PLACE_KEYS, so this must track `properties`,
// not `required`.
// (saved-place.schema.json was read and its descriptions validated at the top of this script; its
// `savedPlaceSchema` / `savedPlaceKeys` are reused here.) Each key carries its authored per-property
// `description` as a doc comment (KDoc/JSDoc), read from the schema — never duplicated here — so the
// cross-platform field semantics live at the point of use: native reads SavedPlaceKeys.kt, web reads
// constants.ts, neither opens the schema. The Kotlin output is a yomp-android source set under
// ktlint's line-length rule, so comment lines are wrapped at DOC_COMMENT_MAX_COL columns (code
// points) on word boundaries.
const DOC_COMMENT_MAX_COL = 100;

// Wrap one description into a doc comment at `indent`, capping each emitted line at DOC_COMMENT_MAX_COL
// code points on word boundaries (never mid-token); continuation lines carry " * ".
function savedPlaceDocComment(text, indent) {
  const budget = DOC_COMMENT_MAX_COL - [...`${indent} * `].length;
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line === "") line = word;
    else if ([...`${line} ${word}`].length <= budget) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line !== "") lines.push(line);
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`).join("\n")}\n${indent} */`;
}

const tsSavedPlaceKeyEntries = savedPlaceKeys
  .map((k) => `${savedPlaceDocComment(savedPlaceSchema.properties[k].description, "  ")}\n  ${JSON.stringify(k)},`)
  .join("\n");
const tsSavedPlaceKeys = `
export const SAVED_PLACE_KEYS = [
${tsSavedPlaceKeyEntries}
] as const;
export type SavedPlaceKey = (typeof SAVED_PLACE_KEYS)[number];
`;
appendFileSync(join(TS_DIR, "constants.ts"), tsSavedPlaceKeys);

const ktSavedPlaceKeyEntries = savedPlaceKeys
  .map((k) => `${savedPlaceDocComment(savedPlaceSchema.properties[k].description, "    ")}\n    ${JSON.stringify(k)},`)
  .join("\n");
const ktSavedPlaceKeys = `// AUTO-GENERATED by scripts/build.mjs from src/schemas/saved-place.schema.json. Do not edit.
package ${KOTLIN_PACKAGE}

// The saved_places write-key ALLOWLIST — all 9 top-level property names (an allowlist, NOT a
// required-field list: photoName and rating are optional but permitted keys). Each key carries its
// authored schema description as a KDoc comment, wrapped at ${DOC_COMMENT_MAX_COL} columns because this
// file is consumed as a yomp-android source set under ktlint's line-length rule.
val SAVED_PLACE_KEYS: List<String> = listOf(
${ktSavedPlaceKeyEntries}
)
`;
writeFileSync(join(KT_COMMON_DIR, "SavedPlaceKeys.kt"), ktSavedPlaceKeys);

console.log("✔ build complete — build/ts + build/kotlin");
