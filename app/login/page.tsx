import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOwnerEmail } from "@/lib/auth/allowlist";
import { isEntitledEmail } from "@/lib/auth/entitlement";
import { CliTitleBar, Wordmark } from "@/components/cli";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    sent?: string;
    requested?: string;
    reqerror?: string;
  }>;
}) {
  const { error, sent, requested, reqerror } = await searchParams;

  // If already logged in, go to dashboard.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && (await isEntitledEmail(user.email))) {
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

      <div className="card-cli mt-8 overflow-hidden p-0">
        <CliTitleBar title="~ request access" />
        <div className="p-6">
          <p className="text-sm text-muted-foreground">
            Not set up yet? Leave your email and we&apos;ll be in touch —
            access is granted manually during the preview.
          </p>

          <form action={requestAccess} className="mt-6 space-y-4">
            <div>
              <label htmlFor="req-email" className="label-cli">
                email
              </label>
              <input
                id="req-email"
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                autoComplete="email"
                className="input-cli"
              />
            </div>
            <div>
              <label htmlFor="req-note" className="label-cli">
                note <span className="text-muted-foreground">(optional)</span>
              </label>
              <textarea
                id="req-note"
                name="note"
                rows={2}
                maxLength={500}
                placeholder="anything we should know"
                className="input-cli"
              />
            </div>
            {/* Honeypot — invisible to humans; bots fill every field. */}
            <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden">
              <label htmlFor="req-company">company</label>
              <input
                id="req-company"
                name="company"
                type="text"
                tabIndex={-1}
                autoComplete="off"
              />
            </div>
            <button type="submit" className="btn-cli w-full">
              request access
            </button>
          </form>

          {requested && (
            <p className="mt-4 font-mono-cli text-sm text-il-navy">
              ~ request received — we&apos;ll be in touch at that address.
            </p>
          )}
          {reqerror && (
            <p className="mt-4 font-mono-cli text-sm" style={{ color: "#EE1D23" }}>
              ~ {reqerror}
            </p>
          )}
        </div>
      </div>

      {process.env.NODE_ENV !== "production" && getOwnerEmail() && (
        <p className="mt-12 text-center font-mono-cli text-xs text-muted-foreground">
          ~ dev hint: owner = {getOwnerEmail()}
        </p>
      )}
    </main>
  );
}

async function sendMagicLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  // Pretend-success for any address that isn't entitled (an owner, or an
  // approved app_users row) so we don't leak who's allowed. The un-entitled
  // branch previously returned instantly while the entitled branch waited on a
  // round-trip — a timing oracle. Pad it into the same latency band.
  if (!(await isEntitledEmail(email))) {
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
      // Auto-provision the auth.users row on first login. Safe because we
      // already confirmed the address is entitled above (approved in
      // app_users, or an owner) — so an approved user needs NO manual Supabase
      // user-creation step; their first magic link mints the row.
      shouldCreateUser: true,
    },
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/login?sent=1");
}

async function requestAccess(formData: FormData) {
  "use server";
  const { validateAccessRequest } = await import("@/lib/auth/access-request");
  const validated = validateAccessRequest({
    email: formData.get("email"),
    note: formData.get("note"),
    honeypot: formData.get("company"),
  });

  // Honeypot: pretend success so the bot learns nothing.
  if (validated.kind === "silent") redirect("/login?requested=1");
  if (validated.kind === "invalid") {
    redirect(`/login?reqerror=${encodeURIComponent(validated.error)}`);
  }

  // Insert under the ANON role — access_requests is insert-only by RLS
  // (migration 0014), never touched with the service role on this public
  // request path. The row is the durable record; the email is best-effort.
  const supabase = await createClient();
  const { error } = await supabase
    .from("access_requests")
    .insert({ email: validated.email, note: validated.note });

  if (error) {
    // Duplicate = someone re-submitting: pretend success (no repeat email to
    // the owner, no "this address already asked" oracle for strangers).
    const duplicate = error.code === "23505";
    if (!duplicate) {
      console.error(`requestAccess: insert failed: ${error.message}`);
    }
    redirect("/login?requested=1");
  }

  // First-time request: notify the owner. Fail-soft — the row is already
  // persisted, so a mail hiccup loses nothing.
  const { sendEmail } = await import("@/lib/email/postmark");
  const to = process.env.POSTMARK_FROM_EMAIL;
  if (to) {
    await sendEmail({
      to,
      subject: `Access request — ${validated.email}`,
      textBody: [
        `New access request on investorlogical.com`,
        ``,
        `Email: ${validated.email}`,
        validated.note ? `Note: ${validated.note}` : `Note: (none)`,
        ``,
        `To grant access: open Setup (dashboard → Setup → access requests) and click Approve. That's it — they can sign in immediately.`,
      ].join("\n"),
    });
  }

  redirect("/login?requested=1");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
