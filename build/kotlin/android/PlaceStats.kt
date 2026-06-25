package dog.yomp.contracts

/**
 * Aggregated community stats for a single place (Firestore collection `place_stats`, doc id
 * = safeId(placeId)). Source of truth for both yomp-next (TS) and yomp-android (Kotlin).
 */
data class PlaceStats (
    /**
     * Optional map keyed by AttributeKey (see community.json) → AttributeCount. Absent on
     * legacy docs predating attribute voting. TS narrows this to `Partial<Record<AttributeKey,
     * AttributeCount>>` (key domain = the six AttributeKeys); Kotlin keeps `Map<String,
     * AttributeCount>?`.
     */
    val attributeCounts: Map<String, AttributeCount>? = null,

    val checkCount: Long? = null,
    val confirmationCount: Long,
    val lastUpdated: com.google.firebase.Timestamp? = null,
    val negativeCount: Long,
    val ratingCount: Long,
    val totalRatingPoints: Long
)

/**
 * Per-attribute up/down vote tally and net score.
 */
data class AttributeCount (
    val down: Long,
    val score: Long,
    val up: Long
)
