import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail, getAllowedEmail } from "@/lib/auth/allowlist";
import { CliTitleBar, Wordmark } from "@/components/cli";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;

  // If already logged in, go to dashboard.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && isAllowedEmail(user.email)) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <div className="mb-8 flex justify-center">
        <Wordmark size="h-14" />
      </div>

      <div className="card-cli overflow-hidden p-0">
        <CliTitleBar title="~ sign in" />
        <div className="p-6">
          <p className="text-sm text-muted-foreground">
            Investorlogical is single-user during the preview. Only the
            configured email can sign in — a magic link is sent, no password.
          </p>

          <form action={sendMagicLink} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="label-cli">
                email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                autoComplete="email"
                className="input-cli"
              />
            </div>
            <button type="submit" className="btn-cli w-full">
              send magic link
            </button>
          </form>

          {sent && (
            <p className="mt-4 font-mono-cli text-sm text-il-navy">
              ~ if that email is allowed, a link is on its way. Check spam; the
              sender throttles to a few emails per hour.
            </p>
          )}
          {error && (
            <p className="mt-4 font-mono-cli text-sm" style={{ color: "#EE1D23" }}>
              ~ {error}
            </p>
          )}
        </div>
      </div>

      {process.env.NODE_ENV !== "production" && getAllowedEmail() && (
        <p className="mt-12 text-center font-mono-cli text-xs text-muted-foreground">
          ~ dev hint: allowlist = {getAllowedEmail()}
        </p>
      )}
    </main>
  );
}

async function sendMagicLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  // Pretend-success on disallowed emails so we don't leak the allowlist.
  // The disallowed branch previously returned instantly while the allowed
  // branch waited on a Supabase round-trip — a timing oracle. Pad it into the
  // same latency band. (Defence in depth: signups are also disabled
  // server-side and RLS is entitlement-gated, so a probed address alone is
  // worth little.)
  if (!isAllowedEmail(email)) {
    await sleep(350 + Math.random() * 900);
    redirect("/login?sent=1");
  }

  const supabase = await createClient();
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      // The owner's auth.users row is provisioned once; never mint users from
      // the login form. (Direct-to-Supabase signups are disabled in the
      // dashboard — this keeps the app's own path consistent with that.)
      shouldCreateUser: false,
    },
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/login?sent=1");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
