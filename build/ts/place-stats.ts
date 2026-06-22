import type { AttributeKey } from "./constants";
import type { FieldValue, Timestamp } from "firebase/firestore";

/**
 * Aggregated community stats for a single place (Firestore collection `place_stats`, doc id
 * = safeId(placeId)). Source of truth for both yomp-next (TS) and yomp-android (Kotlin).
 */
export interface PlaceStats {
    /**
     * Optional map keyed by AttributeKey (see community.json) → AttributeCount. Absent on
     * legacy docs predating attribute voting. TS narrows this to `Partial<Record<AttributeKey,
     * AttributeCount>>` (key domain = the six AttributeKeys); Kotlin keeps `Map<String,
     * AttributeCount>?`.
     */
    attributeCounts?:  Partial<Record<AttributeKey, AttributeCount>>;
    checkCount?:       number;
    confirmationCount: number;
    lastUpdated: Timestamp | FieldValue | null;
    negativeCount:     number;
    ratingCount:       number;
    totalRatingPoints: number;
}

/**
 * Per-attribute up/down vote tally and net score.
 */
export interface AttributeCount {
    down:  number;
    score: number;
    up:    number;
}
