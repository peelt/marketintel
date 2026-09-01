import type { SupabaseClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/errors";
import { getCachedJwks } from "./jwks";

/**
 * Who is making this request — established WITHOUT a call to the auth server.
 *
 * `getUser()` asks the auth server to identify the token holder: correct, but a
 * network round-trip (measured 154ms) that ran twice before every page's first
 * query. `getClaims()` verifies the token's signature locally against the
 * project's public signing key, which is cryptographic proof of the same fact —
 * so long as the project signs asymmetrically (this one does: ES256).
 *
 * Falls back to `getUser()` whenever local verification can't be completed —
 * no keys, an unexpected algorithm, a malformed token, any thrown error. The
 * fallback is the SAFE direction: we never accept a token we could not verify,
 * we just pay the round-trip to have the server vouch for it.
 *
 * This is the app's routing/rendering gate. The security boundary remains RLS
 * (`public.is_app_user()`), as it was before this change.
 */
export interface VerifiedUser {
  id: string;
  email: string | null;
}

export async function verifyUser(
  supabase: SupabaseClient,
): Promise<VerifiedUser | null> {
  try {
    const keys = await getCachedJwks();
    if (keys.length > 0) {
      const { data, error } = await supabase.auth.getClaims(undefined, {
        jwks: { keys },
      });
      if (!error && data?.claims) {
        const claims = data.claims as { sub?: unknown; email?: unknown };
        const id = typeof claims.sub === "string" ? claims.sub : null;
        if (id) {
          return {
            id,
            email: typeof claims.email === "string" ? claims.email : null,
          };
        }
      }
      // No session at all (signed out) is the common "error" here and must not
      // trigger a pointless fallback round-trip.
      if (!error && !data) return null;
    }
  } catch (err) {
    console.error(`verifyUser: local verification failed: ${getErrorMessage(err)}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email ?? null } : null;
}
