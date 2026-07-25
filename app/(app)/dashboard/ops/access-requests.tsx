import { humanizeDateTime } from "@/lib/format";
import type { AccessRequestView } from "@/lib/auth/access-admin";
import { approveAccessRequest, revokeAccessRequest } from "./actions";

/**
 * Owner-only access-request queue on the Setup page. Someone fills the
 * request-access form on the login page → their address lands here → the
 * owner clicks Approve → they're entitled and can sign in (auto-provisioned
 * on first magic link). No env change, no redeploy, no SQL — the whole
 * per-user effort is one button.
 */
export function AccessRequests({ requests }: { requests: AccessRequestView[] }) {
  const pending = requests.filter((r) => !r.approved);
  const approved = requests.filter((r) => r.approved);

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between">
        <div className="font-mono-cli text-base text-il-navy">~ access requests</div>
        {pending.length > 0 && (
          <span className="font-mono-cli text-sm text-il-orange">
            {pending.length} pending
          </span>
        )}
      </div>

      {requests.length === 0 ? (
        <p className="mt-2 text-base text-muted-foreground">
          No one has requested access yet. Requests from the login page appear
          here — approve one and that person can sign in immediately.
        </p>
      ) : (
        <div className="card-cli mt-3 divide-y divide-border p-0">
          {pending.map((r) => (
            <div
              key={r.email}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="font-mono-cli text-base font-bold text-il-navy">
                  {r.email}
                </div>
                <div className="text-sm text-muted-foreground">
                  requested {humanizeDateTime(r.createdAt)}
                  {r.note ? ` · “${r.note}”` : ""}
                </div>
              </div>
              <form action={approveAccessRequest}>
                <input type="hidden" name="email" value={r.email} />
                <button type="submit" className="btn-cli btn-cli-sm">
                  approve
                </button>
              </form>
            </div>
          ))}

          {approved.map((r) => (
            <div
              key={r.email}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <span className="font-mono-cli text-base text-muted-foreground">
                  {r.email}
                </span>
                <span className="ml-2 font-mono-cli text-sm text-il-accent">
                  ✓ approved
                </span>
              </div>
              <form action={revokeAccessRequest}>
                <input type="hidden" name="email" value={r.email} />
                <button
                  type="submit"
                  className="btn-cli-outline btn-cli-sm text-muted-foreground"
                >
                  revoke
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
