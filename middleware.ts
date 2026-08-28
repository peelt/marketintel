import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { verifyUser } from "@/lib/auth/verify";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Triggers token refresh if needed. Result intentionally unused.
  //
  // This verifies the token LOCALLY (lib/auth/verify.ts) rather than asking the
  // auth server, which is what this line used to do on every single request —
  // a 154ms round-trip whose answer was thrown away. Refresh still happens:
  // reading the session renews the cookie when it is actually near expiry.
  await verifyUser(supabase);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static, _next/image
     * - favicon
     * - api/inngest (signed by Inngest, doesn't need cookie refresh)
     * - api/dev/ingest (gated by its own secret header, no session involved)
     * - "/" itself: the static marketing page has no session to refresh, and
     *   the trailing ".+" (not ".*") is what excludes it
     * - STATIC ASSETS by extension: a PNG has no session to refresh, and this
     *   middleware runs (and used to pay an auth round-trip) for every one.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/inngest|api/dev/ingest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf)$).+)",
  ],
};
