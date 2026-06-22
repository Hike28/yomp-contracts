package dog.yomp.contracts

typealias Timestamp = com.google.firebase.Timestamp

/**
 * Aggregated community stats for a single place (Firestore collection `place_stats`, doc id
 * = safeId(placeId)). Source of truth for both yomp-next (TS) and yomp-android (Kotlin).
 */
data class PlaceStats (
    /**
     * Optional map keyed by AttributeKey (see community.json) → AttributeCount. Absent on
     * legacy docs predating attribute voting.
     */
    val attributeCounts: Map<String, AttributeCount>? = null,

    val checkCount: Long? = null,
    val confirmationCount: Long,
    val lastUpdated: Timestamp? = null,
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
