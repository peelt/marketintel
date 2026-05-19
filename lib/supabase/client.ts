import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client. Use only in Client Components for auth flows
 * and realtime subscriptions. RLS-enforced.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
