// Small, dependency-free input helpers.

/** True for a 24-character hex string (the shape of a MongoDB ObjectId). */
export const isObjectIdString = (v) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);

/** Trimmed string, or "" when the value is not a string. */
export const cleanString = (v) => (typeof v === "string" ? v.trim() : "");

/** Array of trimmed, non-empty strings, limited in count and length; [] for anything else. */
export const cleanList = (v, maxItems, maxChars) =>
  Array.isArray(v)
    ? v.filter((x) => typeof x === "string").map((x) => x.trim().slice(0, maxChars)).filter(Boolean).slice(0, maxItems)
    : [];
