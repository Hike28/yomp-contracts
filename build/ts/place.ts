/**
 * A discoverable venue as the apps render it — the shape carried by /api/places, the L1/L2
 * caches and the map/bottom-sheet surfaces. AUTHORED FROM yomp-next/src/types/place.ts
 * (verified against a533bfc): field-for-field, same names, same types, same optionality.
 * This schema DOCUMENTS the shape that already exists; it does not redesign it, and no
 * field may be added, renamed or dropped here without the same change landing in place.ts.
 * NOTE: `dogStatus` is the RESOLVED place-status vocabulary (yes|no|unknown), which is NOT
 * the community-VOTE vocabulary STATUS (yes|no|check) in community.json — see the
 * DOG_STATUS constant. The two are intentionally distinct and must never be merged. The
 * dogStatus enum here is build-guarded to equal community.json's dogStatus exactly. Source
 * of truth for yomp-next (TS), yomp-android (Kotlin) and a future iOS client. TYPE NOTES:
 * TS is emitted with --prefer-unions so every enum below becomes a string union identical
 * to place.ts; Kotlin post-processes those enums to plain String, per the same principle as
 * account.json's key lists (an out-of-vocabulary wire value must be filterable on read,
 * never a deserialisation crash). Counter fields are `integer` so Kotlin gets Long,
 * matching PlaceStats.ratingCount.
 */
export interface Place {
    /**
     * Formatted street address.
     */
    address?: string;
    /**
     * Google businessStatus - written back from place-details enrichment.
     */
    businessStatus?: BusinessStatus;
    /**
     * The RESOLVED dog-friendliness of this place, as rendered. This is the DOG_STATUS
     * vocabulary (yes|no|unknown), NOT the community-vote STATUS vocabulary (yes|no|check) -
     * the two are intentionally distinct, do not merge them. Set by dogStatusResolver; see
     * dogStatusSource for its provenance.
     */
    dogStatus: DogStatus;
    /**
     * Confidence label attached to the resolved dogStatus. A label only - it never changes the
     * status itself.
     */
    dogStatusConfidence?: DogStatusConfidence;
    /**
     * Provenance of the dogStatus value above. Set by dogStatusResolver. Used by BottomSheet to
     * caption the badge ("Verified" / "12 dog owners" / etc). Optional - older cached venues
     * from before the resolver landed lack it.
     */
    dogStatusSource?: DogStatusSource;
    /**
     * Total community votes when dogStatusSource === 'community'.
     */
    dogStatusVoteCount?: number;
    /**
     * Google Places editorial summary - a short description authored by Google.
     */
    editorialSummary?: string;
    /**
     * Provider place id as discovery returned it (Google Places id, DataForSEO id, or an
     * `osm_`-prefixed seed id). Raw, NOT the safeId form — callers sanitise with safeId() when
     * deriving a Firestore doc id.
     */
    id: string;
    /**
     * Venue latitude, WGS84 decimal degrees.
     */
    lat: number;
    /**
     * Venue longitude, WGS84 decimal degrees.
     */
    lng: number;
    /**
     * Direct googleusercontent.com image URL returned by DFSEO main_image. Used as a fallback
     * photo while Google Place Details enrichment loads. Not a Google Places photo resource
     * name - cannot be used with the /api/place-photo proxy. Render as a plain <img src> only.
     */
    mainImage?: string;
    /**
     * Venue display name.
     */
    name: string;
    /**
     * Whether the venue is open at the moment the payload was built. A snapshot, not a live
     * value - stale once cached.
     */
    openNow?: boolean;
    /**
     * Contact telephone number as the provider returned it.
     */
    phone?: string;
    /**
     * Google Places photo resource names, e.g. `places/ChIJ.../photos/AVz...`. Up to 3 names
     * are kept per place to cap payload size and billable photo fetches. Use <PlacePhoto
     * name={...} /> to render. Empty/missing means the caller should show the emoji+gradient
     * fallback.
     */
    photoNames?: string[];
    /**
     * Google Places star rating (1-5). NOT the Yomp community paw average (deriveAverageRating).
     */
    rating?: number;
    /**
     * Number of Google Places ratings behind `rating`. NOT the Yomp community vote count.
     */
    ratingCount?: number;
    /**
     * Ownership/verification tier. Drives the Verified Basic brass-pin treatment on the map.
     * Ownership data (not Google enrichment - lives on Place, not PlaceEnrichment). Absent on
     * uncached / legacy venues, which are treated as unclaimed. verified_premium renders
     * identically to verified_basic for now.
     */
    tier?: Tier;
    /**
     * Human-readable opening hours for the current day only. See weeklyHours for the full week.
     */
    todayHours?: string;
    /**
     * Raw provider primary-type string exactly as discovery returned it (Google Places New
     * primaryType, or the DataForSEO type) - e.g. 'bar', 'park'. Open vocabulary; 'unknown'
     * when absent. NOT a Yomp CategoryKey: consumers collapse this to a category at read time
     * via getCategoryFromType().
     */
    type: string;
    /**
     * Venue website URL.
     */
    website?: string;
    /**
     * Full 7-day opening hours mapped directly from DFSEO timetable. Array of human-readable
     * strings, one per day, e.g. "Monday: 9:00-17:00". Populated by formatDfseoItem.
     * Supplements todayHours without needing a Google Place Details call.
     */
    weeklyHours?: string[];
}

/**
 * Google businessStatus - written back from place-details enrichment.
 */
export type BusinessStatus = "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";

/**
 * The RESOLVED dog-friendliness of this place, as rendered. This is the DOG_STATUS
 * vocabulary (yes|no|unknown), NOT the community-vote STATUS vocabulary (yes|no|check) -
 * the two are intentionally distinct, do not merge them. Set by dogStatusResolver; see
 * dogStatusSource for its provenance.
 */
export type DogStatus = "yes" | "no" | "unknown";

/**
 * Confidence label attached to the resolved dogStatus. A label only - it never changes the
 * status itself.
 */
export type DogStatusConfidence = "high" | "medium" | "low";

/**
 * Provenance of the dogStatus value above. Set by dogStatusResolver. Used by BottomSheet to
 * caption the badge ("Verified" / "12 dog owners" / etc). Optional - older cached venues
 * from before the resolver landed lack it.
 */
export type DogStatusSource = "owner" | "community" | "google" | "dataforseo_keyword" | "default";

/**
 * Ownership/verification tier. Drives the Verified Basic brass-pin treatment on the map.
 * Ownership data (not Google enrichment - lives on Place, not PlaceEnrichment). Absent on
 * uncached / legacy venues, which are treated as unclaimed. verified_premium renders
 * identically to verified_basic for now.
 */
export type Tier = "unclaimed" | "claimed" | "verified_basic" | "verified_premium";
