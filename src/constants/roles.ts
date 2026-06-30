export const ROLES = {
  USER: "user",
  BUSINESS: "business",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];
