package dog.yomp.contracts

/**
 * A Yomp user's Firestore document (collection `users`, doc id = uid). PARTIAL-PATCH model:
 * every top-level field is OPTIONAL (no root `required[]`) because writes patch a subset.
 * All stored values are PRIMITIVE — there are deliberately NO string enums in this schema,
 * so out-of-domain values (e.g. a future provider or theme) deserialise as plain strings on
 * both platforms and can never crash a typed enum. Source of truth for both yomp-next (TS)
 * and yomp-android (Kotlin).
 */
data class UserRecord (
    /**
     * Opaque acquisition/attribution payload — shape intentionally unconstrained.
     */
    val acquisitionSource: Map<String, Any?>? = null,

    val appVersion: String? = null,
    val createdAt: com.google.firebase.Timestamp? = null,
    val displayName: String? = null,
    val dog: Dog? = null,

    /**
     * LEGACY web multi-dog list. Not written by native v1. Reconcile with singular `dog` in a
     * future migration.
     */
    val dogs: List<DogListEntry>? = null,

    val email: String? = null,
    val lastSignIn: com.google.firebase.Timestamp? = null,
    val marketingConsent: Boolean? = null,
    val onboardingCompletedAt: com.google.firebase.Timestamp? = null,
    val photoURL: String? = null,
    val platform: String? = null,

    /**
     * Each element should be a CATEGORY_KEYS value; consumers must filter unknown values on
     * read.
     */
    val preferredCategories: List<String>? = null,

    /**
     * Auth provider id. Should be an AUTH_PROVIDERS value (see account.json) but is a plain
     * string — validated at the app layer, never a typed enum.
     */
    val provider: String? = null,

    val seenPlaceIds: List<String>? = null,
    val signInCount: Long? = null,

    /**
     * One of THEME_MODES. Writing any other value is rejected by Firestore rules.
     */
    val themeMode: String? = null,

    val uid: String? = null,
    val updatedAt: com.google.firebase.Timestamp? = null,
    val username: String? = null
)

/**
 * Canonical single-dog shape (native + active web). birthday is canonical; dob is legacy.
 */
data class Dog (
    val avatarUrl: String? = null,
    val birthday: DogBirthday,
    val breed: String,
    val dob: String? = null,
    val name: String,
    val onboardingVersion: Long? = null
)

/**
 * Canonical birthday for the singular `dog`. month + year are required; day is optional
 * (some users give only month/year).
 */
data class DogBirthday (
    val day: Long? = null,
    val month: Long,
    val year: Long
)

/**
 * LEGACY web multi-dog list. Not written by native v1. Reconcile with singular `dog` in a
 * future migration.
 */
data class DogListEntry (
    val avatarUrl: String? = null,
    val birthday: Map<String, Any?>? = null,
    val breed: String,
    val id: String,
    val name: String,
    val preferredCategory: String? = null,
    val size: String
)
