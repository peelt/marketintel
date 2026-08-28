import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isEntitledEmail } from "./entitlement";
import { isOwnerEmail } from "./allowlist";
import { verifyUser } from "./verify";

export interface SessionContext {
  userId: string | null;
  email: string | null;
  entitled: boolean;
  isOwner: boolean;
}

/**
 * The per-request session context, resolved ONCE.
 *
 * Every authenticated page previously ran its own `getUser()` + entitlement
 * check, and the app shell now needs the same facts — that would be two or
 * three identical round-trips before a single data query could start. React's
 * `cache()` dedupes it per request: the layout and the page it wraps share one
 * resolution, so the auth waterfall is paid once per navigation instead of once
 * per component.
 *
 * This is a routing/rendering gate, not the security boundary — RLS
 * (`is_app_user()`) remains the real one.
 */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const supabase = await createClient();
  // Local signature verification, not a call to the auth server — see
  // lib/auth/verify.ts. This used to be one of TWO getUser() round-trips paid
  // serially before any page could start its first query.
  // Local signature verification, not a call to the auth server — see
  // lib/auth/verify.ts. This used to be one of TWO getUser() round-trips paid
  // serially before any page could start its first query.
  const user = await verifyUser(supabase);
  if (!user) {
    return { userId: null, email: null, entitled: false, isOwner: false };
  }
  return {
    userId: user.id,
    email: user.email,
    entitled: await isEntitledEmail(user.email),
    isOwner: isOwnerEmail(user.email),
  };
});
