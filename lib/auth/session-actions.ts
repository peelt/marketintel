"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Ends the session and returns to the login page. Lives in its own "use server"
 * module so the shared SiteHeader (a server-safe component in components/cli)
 * can wire it into a form without pulling server-only Supabase code into any
 * client bundle that imports the header's sibling building blocks.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
