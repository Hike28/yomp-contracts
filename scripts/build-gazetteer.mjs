// yomp-contracts gazetteer build — OS Open Names → data/gb-places.json
//
// A committed dataset of Great Britain's populated places (city / town / village / hamlet /
// suburb / settlement) with WGS84 coordinates, powering native map town-search.
//
// This is DATA, not codegen. It deliberately does NOT flow through scripts/build.mjs:
// no quicktype, no constants emitter, no Kotlin object. 43k entries have no business
// being a generated source file. The emitted JSON is committed and read at runtime.
//
//   OS Downloads API (OpenData, no key) --download--> opname_csv_gb.zip (.cache/)
//   820 headerless tile CSVs            --filter---->  TYPE == "populatedPlace"
//   BNG easting/northing (EPSG:27700)   --proj4----->  WGS84 lat/lng (EPSG:4326)
//                                       --sort------>  data/gb-places.json
//
// SOURCE
//   OS Open Names, Ordnance Survey. Discovered live via the OS Data Hub Downloads API:
//     https://api.os.uk/downloads/v1/products/OpenNames/downloads
//   No API key is required for OS OpenData. The download manifest carries an md5 which
//   this script verifies before unpacking — a corrupt or substituted archive fails loudly.
//
// LICENCE
//   OS OpenData is released under the Open Government Licence v3 (OGL).
//   Any consuming app MUST surface this attribution in its UI:
//
//       Contains OS data (c) Crown Copyright and database rights 2026.
//
//   (The product's own Doc/licence.txt also lists Royal Mail and National Statistics
//   acknowledgements. Those attach to the postcode records, which this extract excludes
//   entirely, so they are not required for the derived dataset.)
//
// COORDINATE CONVERSION
//   OS Open Names ships British National Grid eastings/northings only — there is no
//   lat/lng in the product, so conversion is mandatory. Done with proj4 using the standard
//   OSGB36 7-parameter Helmert transform. That is accurate to roughly 2-5 m, versus the
//   centimetre-accurate OSTN15 grid-shift. For settlement-centroid search that is far
//   inside tolerance; do not reuse this transform for anything survey-grade.
//
// DETERMINISM
//   Re-running must produce a byte-identical file, so the dataset stays diffable:
//     - coordinates are rounded to 5 dp (~1 m), which pins the output against float
//       noise from a future proj4 patch release;
//     - entries are sorted by a TOTAL order (name, type, lat, lng) using plain codepoint
//       comparison. Codepoint, NOT localeCompare: locale collation depends on the ICU
//       build shipped with Node, so a different machine could otherwise reorder the whole
//       file and produce a spurious 43k-line diff;
//     - archive entries are processed in sorted order, never in zip/readdir order.
//
// RE-RUN
//   npm run build:gazetteer
//
//   Downloads ~98 MiB to .cache/ on first run (gitignored, never committed) and reuses it
//   afterwards. Delete .cache/ to force a fresh pull when OS publishes a new version — the
//   product is versioned (2026-04 at time of writing) and the version is logged each run.
//
//   Consumers NEVER run this. They read the committed data/gb-places.json via the
//   submodule, exactly as they read build/. Nothing is downloaded at consumer build time.
import AdmZip from "adm-zip";
import proj4 from "proj4";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(ROOT, ".cache");
const ZIP_PATH = join(CACHE_DIR, "opname_csv_gb.zip");
const OUT_PATH = join(ROOT, "data", "gb-places.json");

const PRODUCT_URL = "https://api.os.uk/downloads/v1/products/OpenNames";
const DOWNLOADS_URL = `${PRODUCT_URL}/downloads`;

// ── OS Open Names CSV layout ──────────────────────────────────────────────────
// The tile CSVs are HEADERLESS; the column order is defined by Doc/OS_Open_Names_Header.csv
// shipped inside the archive. Only the four columns below are read.
const COL_NAME1 = 2;
const COL_TYPE = 6;
const COL_LOCAL_TYPE = 7;
const COL_GEOMETRY_X = 8; // easting, metres, EPSG:27700
const COL_GEOMETRY_Y = 9; // northing, metres, EPSG:27700

// The coarse TYPE that selects settlements. Everything else in the product — postcodes
// (1.74M rows), named roads (0.88M), woodland, hills, schools — is discarded.
const POPULATED_PLACE = "populatedPlace";

// The COMPLETE LOCAL_TYPE vocabulary under TYPE=populatedPlace, mapped to emitted slugs.
// Verified against the 2026-04 release: exactly these six values occur, and no others.
// An unmapped value is a FATAL error (see below), never a silent drop — if OS introduces a
// seventh settlement class we find out by failing the build, not by shipping a gazetteer
// that quietly lost a category.
const LOCAL_TYPE_TO_SLUG = {
  City: "city",
  Town: "town",
  Village: "village",
  Hamlet: "hamlet",
  "Suburban Area": "suburb",
  "Other Settlement": "settlement",
};

// GB bounding box, used as a post-conversion sanity gate. A coordinate outside this box
// means the projection or the column mapping is wrong; fail rather than emit it.
const GB_BOUNDS = { minLat: 49.8, maxLat: 61.0, minLng: -8.7, maxLng: 2.0 };

const COORD_DP = 5;

// EPSG:27700 (OSGB36 / British National Grid) → EPSG:4326 (WGS84).
const EPSG_27700 =
  "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy " +
  "+towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs";
const EPSG_4326 = "+proj=longlat +datum=WGS84 +no_defs";
const toWgs84 = proj4(EPSG_27700, EPSG_4326);

// ── 1. Acquire the archive (cached) ───────────────────────────────────────────
async function ensureArchive() {
  const productRes = await fetch(PRODUCT_URL);
  if (!productRes.ok) throw new Error(`OS Downloads API: product lookup failed (${productRes.status}).`);
  const product = await productRes.json();
  console.log(`OS Open Names — product version ${product.version}`);

  const downloadsRes = await fetch(DOWNLOADS_URL);
  if (!downloadsRes.ok) throw new Error(`OS Downloads API: download manifest failed (${downloadsRes.status}).`);
  const manifest = await downloadsRes.json();

  const csv = manifest.find((d) => d.format === "CSV" && d.area === "GB");
  if (!csv) {
    throw new Error(
      `OS Downloads API: no CSV/GB entry in the manifest. Available: ` +
        `${manifest.map((d) => `${d.format}/${d.area}`).join(", ")}.`,
    );
  }

  const md5Of = (buf) => createHash("md5").update(buf).digest("hex");

  if (existsSync(ZIP_PATH)) {
    const cached = readFileSync(ZIP_PATH);
    if (md5Of(cached) === csv.md5) {
      console.log(`Using cached ${csv.fileName} (${cached.length} bytes, md5 verified).`);
      return cached;
    }
    console.log("Cached archive does not match the current manifest md5 — re-downloading.");
  }

  console.log(`Downloading ${csv.fileName} (${csv.size} bytes)...`);
  const res = await fetch(csv.url);
  if (!res.ok) throw new Error(`OS Downloads API: download failed (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());

  // The manifest md5 is the integrity contract. A mismatch means a truncated or
  // substituted archive; refuse to build a dataset from it.
  const actual = md5Of(buf);
  if (actual !== csv.md5) {
    throw new Error(`Downloaded archive md5 ${actual} does not match the manifest md5 ${csv.md5}.`);
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(ZIP_PATH, buf);
  console.log(`Cached to .cache/${csv.fileName} (md5 verified).`);
  return buf;
}

// ── 2. CSV parsing ────────────────────────────────────────────────────────────
// Place names contain commas ("Newton, Old" style) and quoted fields, so the rows are
// parsed properly rather than split on ",".
function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { fields.push(field); field = ""; }
    else field += c;
  }
  fields.push(field);
  return fields;
}

// ── 3. Extract populated places ───────────────────────────────────────────────
function extractPlaces(zipBuffer) {
  const zip = new AdmZip(zipBuffer);

  // Sorted so processing order never depends on the archive's internal entry order.
  const tiles = zip
    .getEntries()
    .filter((e) => !e.isDirectory && /^Data\/.+\.csv$/i.test(e.entryName.replace(/\\/g, "/")))
    .sort((a, b) => (a.entryName < b.entryName ? -1 : a.entryName > b.entryName ? 1 : 0));

  if (tiles.length === 0) throw new Error("No Data/*.csv tiles found in the archive — layout changed?");
  console.log(`Scanning ${tiles.length} tile CSVs...`);

  const places = [];
  let scanned = 0;

  for (const tile of tiles) {
    // Each tile is BOM-prefixed and headerless.
    const text = tile.getData().toString("utf8").replace(/^﻿/, "");
    for (const line of text.split(/\r?\n/)) {
      if (line === "") continue;
      scanned++;
      const cols = parseCsvLine(line);
      if (cols[COL_TYPE] !== POPULATED_PLACE) continue;

      const localType = cols[COL_LOCAL_TYPE];
      const type = LOCAL_TYPE_TO_SLUG[localType];
      if (type === undefined) {
        throw new Error(
          `Unrecognised LOCAL_TYPE "${localType}" under TYPE=${POPULATED_PLACE} ` +
            `(tile ${tile.entryName}). OS has changed the settlement vocabulary: add it to ` +
            `LOCAL_TYPE_TO_SLUG deliberately rather than letting a place class vanish.`,
        );
      }

      const name = cols[COL_NAME1];
      if (typeof name !== "string" || name.trim() === "") {
        throw new Error(`Empty NAME1 on a ${POPULATED_PLACE} row in ${tile.entryName}.`);
      }

      const easting = Number(cols[COL_GEOMETRY_X]);
      const northing = Number(cols[COL_GEOMETRY_Y]);
      if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
        throw new Error(`Non-numeric BNG coordinate for "${name}" in ${tile.entryName}.`);
      }

      const [rawLng, rawLat] = toWgs84.forward([easting, northing]);
      const lat = Number(rawLat.toFixed(COORD_DP));
      const lng = Number(rawLng.toFixed(COORD_DP));
      if (
        lat < GB_BOUNDS.minLat || lat > GB_BOUNDS.maxLat ||
        lng < GB_BOUNDS.minLng || lng > GB_BOUNDS.maxLng
      ) {
        throw new Error(
          `"${name}" converted to ${lat},${lng} — outside GB bounds. ` +
            `The projection or the column mapping is wrong.`,
        );
      }

      places.push({ name, type, lat, lng });
    }
  }

  console.log(`Scanned ${scanned} rows; kept ${places.length} populated places.`);
  return places;
}

// ── 4. Deterministic total order ──────────────────────────────────────────────
// Codepoint comparison, not localeCompare — see the DETERMINISM note in the header.
// Duplicates are KEPT: the same name recurs across GB as genuinely distinct places
// (Newtown occurs 90 times), so (name, type, lat, lng) is what makes the order total.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function sortPlaces(places) {
  return places.sort(
    (a, b) => cmp(a.name, b.name) || cmp(a.type, b.type) || a.lat - b.lat || a.lng - b.lng,
  );
}

// ── 5. Emit ───────────────────────────────────────────────────────────────────
const places = sortPlaces(extractPlaces(await ensureArchive()));

// Minified: this is machine-read data, not a file anyone reviews line by line.
const json = JSON.stringify(places);
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, json);

const byType = {};
for (const p of places) byType[p.type] = (byType[p.type] || 0) + 1;
const names = new Map();
for (const p of places) names.set(p.name, (names.get(p.name) || 0) + 1);
const collidingNames = [...names.values()].filter((n) => n > 1).length;

console.log("\nWrote data/gb-places.json");
console.log(`  entries      ${places.length}`);
console.log(`  by type      ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(" ")}`);
console.log(`  distinct     ${names.size} names (${collidingNames} occur more than once)`);
// Byte length, not String#length: accented names (Àird a' Mhulaidh, Ynys Môn) are
// multi-byte in UTF-8, so the code-unit count understates the real file size.
const rawBytes = Buffer.byteLength(json, "utf8");
const gzipBytes = gzipSync(json).length;
console.log(`  raw          ${rawBytes} bytes (${(rawBytes / 1048576).toFixed(2)} MiB)`);
console.log(`  gzipped      ${gzipBytes} bytes (${(gzipBytes / 1024).toFixed(0)} KiB)`);
