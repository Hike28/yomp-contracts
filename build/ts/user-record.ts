import type { FieldValue, Timestamp } from "firebase/firestore";

/**
 * A Yomp user's Firestore document (collection `users`, doc id = uid). PARTIAL-PATCH model:
 * every top-level field is OPTIONAL (no root `required[]`) because writes patch a subset.
 * All stored values are PRIMITIVE — there are deliberately NO string enums in this schema,
 * so out-of-domain values (e.g. a future provider or theme) deserialise as plain strings on
 * both platforms and can never crash a typed enum. Source of truth for both yomp-next (TS)
 * and yomp-android (Kotlin).
 */
export interface UserRecord {
    /**
     * Opaque acquisition/attribution payload — shape intentionally unconstrained.
     */
    acquisitionSource?: { [key: string]: any };
    appVersion?:        string;
    createdAt?: Timestamp | FieldValue | null;
    displayName?:       string;
    dog?:               Dog;
    /**
     * LEGACY web multi-dog list. Not written by native v1. Reconcile with singular `dog` in a
     * future migration.
     */
    dogs?:                  DogListEntry[];
    email?:                 string;
    lastSignIn?: Timestamp | FieldValue | null;
    marketingConsent?:      boolean;
    onboardingCompletedAt?: Timestamp | FieldValue | null;
    photoURL?:              string;
    platform?:              string;
    /**
     * Each element should be a CATEGORY_KEYS value; consumers must filter unknown values on
     * read.
     */
    preferredCategories?: string[];
    /**
     * Auth provider id. Should be an AUTH_PROVIDERS value (see account.json) but is a plain
     * string — validated at the app layer, never a typed enum.
     */
    provider?: string;
    /**
     * Whether this account is a standard user or a business claiming venues. Plain string —
     * validated at the app layer via ROLES constants; never a typed enum.
     */
    role?:         string;
    seenPlaceIds?: string[];
    signInCount?:  number;
    /**
     * One of THEME_MODES. Writing any other value is rejected by Firestore rules.
     */
    themeMode?: string;
    uid?:       string;
    updatedAt?: Timestamp | FieldValue | null;
    username?:  string;
    /**
     * Display-cased form of `username` (e.g. "TomWalks") for presentation; the canonical
     * `username` stays lowercase (join key + uniqueness doc id). OPTIONAL — legacy lowercase
     * users have none; the claim API writes it on a new claim. Allows UPPERCASE, unlike the
     * canonical handle. The pattern documents the Firestore-rules constraint
     * (`^[a-zA-Z0-9_]{3,20}$`); the build is type-only so it is not propagated into the
     * generated types.
     */
    usernameDisplay?: string;
}

/**
 * Canonical single-dog shape (native + active web). birthday is canonical; dob is legacy.
 */
export interface Dog {
    avatarUrl?:         string;
    birthday:           DogBirthday;
    breed:              string;
    dob?:               string;
    name:               string;
    onboardingVersion?: number;
}

/**
 * Canonical birthday for the singular `dog`. month + year are required; day is optional
 * (some users give only month/year).
 */
export interface DogBirthday {
    day?:  number;
    month: number;
    year:  number;
}

/**
 * LEGACY web multi-dog list. Not written by native v1. Reconcile with singular `dog` in a
 * future migration.
 */
export interface DogListEntry {
    avatarUrl?:         string;
    birthday?:          { [key: string]: any };
    breed:              string;
    id:                 string;
    name:               string;
    preferredCategory?: string;
    size:               string;
}
