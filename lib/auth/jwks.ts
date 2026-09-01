import { getErrorMessage } from "@/lib/errors";

/**
 * The project's JWT signing keys, cached for the life of the server instance.
 *
 * Why this exists: `auth.getClaims()` verifies an access token LOCALLY (WebCrypto
 * against the project's public key) instead of asking the auth server who the
 * user is — that call was 154ms, and two of them ran before every page's first
 * query (middleware + layout). But auth-js caches the key set on the client
 * INSTANCE, and `createServerClient()` builds a fresh one per request, so
 * without this the per-request auth-server hop would just become a per-request
 * JWKS hop. Caching the keys here and passing them into `getClaims({ keys })`
 * is what actually removes the round-trip.
 *
 * Server-only. Public verification keys — nothing secret lives here.
 */

/**
 * Structurally compatible with auth-js's `JWK` (which it does not re-export
 * through supabase-js). Declared here rather than imported from the transitive
 * package so a hoisting change can't break the build.
 */
export interface JwkKey {
  kty: string;
  key_ops: string[];
  alg?: string;
  kid?: string;
  [k: string]: unknown;
}

/** Refetched occasionally so a rotated signing key is picked up without a deploy. */
const JWKS_TTL_MS = 10 * 60 * 1000;

let cached: { keys: JwkKey[]; at: number } | null = null;
/** Dedupes concurrent first-callers so a cold instance fetches once, not N times. */
let inFlight: Promise<JwkKey[]> | null = null;

/** Clear the cache (tests; harmless in prod). */
export function clearJwksCache(): void {
  cached = null;
  inFlight = null;
}

/**
 * The project's public signing keys, or an empty array if they can't be
 * fetched. Empty is a valid answer: the caller then has no key to verify with
 * and must fall back to the network path rather than trusting the token.
 */
export async function getCachedJwks(): Promise<JwkKey[]> {
  const now = Date.now();
  if (cached && now - cached.at < JWKS_TTL_MS) return cached.keys;
  if (inFlight) return inFlight;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return [];

  inFlight = (async () => {
    try {
      const res = await fetch(`${url}/auth/v1/.well-known/jwks.json`, {
        // Next would otherwise cache this fetch in the request-scoped data
        // cache; the module-level cache above is the one we want.
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`jwks ${res.status}`);
      const body: unknown = await res.json();
      const raw =
        body && typeof body === "object" && Array.isArray((body as { keys?: unknown }).keys)
          ? (body as { keys: unknown[] }).keys
          : [];
      // Keep only entries that carry what verification needs; a malformed key
      // must not poison the cache and silently disable verification.
      const keys = raw.filter(
        (k): k is JwkKey =>
          !!k &&
          typeof k === "object" &&
          typeof (k as { kty?: unknown }).kty === "string" &&
          Array.isArray((k as { key_ops?: unknown }).key_ops),
      );
      // Only cache a real answer — an empty set would pin the fallback path
      // in place for the whole TTL.
      if (keys.length > 0) cached = { keys, at: Date.now() };
      return keys;
    } catch (err) {
      console.error(`getCachedJwks: ${getErrorMessage(err)}`);
      return [];
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
