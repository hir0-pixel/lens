/**
 * Recursive, key-order-independent canonicalizer, shared by every signer/verifier in this
 * repository. `JSON.stringify(value, Object.keys(value).sort())` is NOT this: the second
 * argument to `JSON.stringify` is a replacer *array*, which filters keys at every nesting
 * level (not just the top), so a top-level key list applied to a structure with a nested
 * array/object collapses every nested object down to whichever of its OWN keys happen to
 * match a top-level key name — for `{entries: [...]}` that is none, so every entry silently
 * canonicalizes to `{}` and a signature built from it covers only the entry count. This walks
 * the structure itself and sorts keys at every level. See `groundingPolicy.ts`'s history for
 * the exact defect this replaces.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
