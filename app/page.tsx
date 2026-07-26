import Link from "next/link";
import { agentRegistry } from "@/lib/agents/registry";
import { CliTitleBar, Star, Wordmark, MODULE_COLORS } from "@/components/cli";
import { CliTyping } from "@/components/cli-typing";
import { ExperimentalNotice } from "@/components/experimental-notice";
import type { AgentName } from "@/lib/agents/types";

export default function Home() {
  // Energy is deprioritised (see settled decisions) — don't advertise it as a
  // permanently-"planned" card the product has no intent to ship soon.
  const agents = agentRegistry.list().filter((a) => a.name !== "energy");
  const liveCount = agents.filter((a) => a.status === "live").length;
  // Product hierarchy: Reaction is the hero desk (featured card); the weekly
  // specialists are the supporting newsroom.
  const reaction = agents.find((a) => a.name === "reaction");
  const supporting = agents.filter((a) => a.name !== "reaction");

  return (
    <main>
      {/* Hero */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-baseline justify-between">
            <Wordmark size="h-16 lg:h-20" />
            <span className="hidden font-mono-cli text-sm text-muted-foreground sm:inline">
              guest@investorlogical:~
            </span>
          </div>
        </div>
        {/* Equal columns: the copy is the heavier side, so giving it the
            NARROWER half (the old 5fr/7fr) forced the h1 to three ragged lines
            and the paragraph to six, while the short terminal panel floated in
            acres of its own space. Matched widths + trimmed copy + a fuller
            panel make the two sides read as one block. */}
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 pt-10 pb-10 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <CliTyping text="~ initialising research desk… [OK]" className="text-base text-il-navy" />
            <span className="tag-cli mt-4 inline-flex">
              AI-powered · evidence-backed · glass-box
            </span>
            <h1 className="mt-4 text-balance text-4xl font-bold text-il-navy lg:text-6xl">
              A sharp drop. Earned, or overshoot?
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              When a stock falls hard, the Reaction desk researches the news
              that evening, grades the damage, and files a verdict with every
              source cited — while {liveCount - 1} weekly desks watch the rest.
            </p>
            <div className="mt-8 flex gap-3">
              <Link href="/login" className="btn-cli btn-cli-lg">
                sign in
              </Link>
              <Link href="/login" className="btn-cli-outline btn-cli-lg">
                request access
              </Link>
            </div>
          </div>

          {/* Self-framing terminal panel */}
          <div className="card-cli overflow-hidden p-0">
            <CliTitleBar title="~ investorlogical.com/reports" />
            {/* Lines are deliberately short enough to survive the narrower
                half-width column without wrapping, and there are enough of
                them to stand level with the copy beside it. */}
            {/* text-sm until sm: the lines are long enough to wrap mid-verdict
                on a phone at the full size, which reads as broken output. */}
            <div className="space-y-2 p-6 font-mono-cli text-sm text-il-navy sm:text-base">
              <div className="text-muted-foreground">~ run reaction --screen sp500,ftse350</div>
              <div>
                <Star /> 847 screened · 3 cleared the threshold
              </div>
              <div>
                <Star /> NXT.L −14.2% · mild_overshoot · 6 sources
              </div>
              <div>
                <Star /> APP −11.8% · proportionate · 4 sources
              </div>
              <div>
                <Star /> BT.A −9.4% · underreaction · 5 sources
              </div>
              <div>
                <Star /> coverage 82% · framework v1 · evidence attached
              </div>
              <div className="text-muted-foreground">~ analyse NVDA --now</div>
              <div>
                <Star /> queued · files after tonight&apos;s close
              </div>
              <div className="text-muted-foreground">
                ~ done in 214s <span className="cursor-blink" />
              </div>
            </div>
          </div>
        </div>
        {/* Full-width band so it never crowds the two-column hero. */}
        <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
          <ExperimentalNotice />
        </div>
      </section>

      <hr className="divider-cli" />

      {/* The newsroom — Reaction leads (featured, full width), the weekly
          specialists back it. Product hierarchy, not a grab-bag of equals. */}
      <section className="bg-il-tint">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="font-mono-cli text-base text-il-navy">~ the newsroom</div>
          <h2 className="mt-2 text-3xl font-bold text-il-navy lg:text-4xl">
            One desk leads. {liveCount - 1} specialists back it.
          </h2>
          {reaction && (
            <div
              className="card-cli card-cli-module mt-8 p-6 lg:p-8"
              style={
                {
                  "--module-color": MODULE_COLORS["reaction"],
                } as React.CSSProperties
              }
            >
              <div className="text-xl font-bold text-il-navy">
                {reaction.displayName}
              </div>
              <p className="mt-2 max-w-3xl text-base leading-relaxed text-muted-foreground">
                {reaction.scope}
              </p>
              <div className="mt-4 font-mono-cli text-sm text-muted-foreground">
                ~ live · {reaction.cadence} · on-demand: put any covered name in
                front of the desk
              </div>
            </div>
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {supporting.map((a) => (
              <div
                key={a.name}
                className="card-cli card-cli-module p-6"
                style={{ "--module-color": MODULE_COLORS[a.name as AgentName] } as React.CSSProperties}
              >
                <div className="font-bold text-il-navy">{a.displayName}</div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {a.description}
                </p>
                <div className="mt-4 font-mono-cli text-sm text-muted-foreground">
                  ~ {a.status === "live" ? `live · ${a.cadence}` : "planned"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <hr className="divider-cli" />

      {/* Holdings + alerts */}
      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[7fr_5fr] lg:px-8">
          <div>
            <div className="font-mono-cli text-base text-il-navy">~ your holdings</div>
            <h2 className="mt-2 text-3xl font-bold text-il-navy lg:text-4xl">
              It watches the names you own
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Add your positions and the intel lens diffs every scheduled run
              against the last — what&apos;s new, what worsened, what resolved.
              When a desk flags a name you hold, an email finds you. No tips, no
              advice: only what changed, with the evidence behind it.
            </p>
          </div>

          <div className="card-cli overflow-hidden p-0">
            <CliTitleBar title="~ holding-alerts" />
            <div className="space-y-2 p-6 font-mono-cli text-base text-il-navy">
              <div className="text-muted-foreground">~ metals-weekly filed a report</div>
              <div>
                <Star /> AEM · well positioned → vulnerable
              </div>
              <div>
                <Star /> 1 held name needs a look · evidence attached
              </div>
              <div className="text-muted-foreground">
                ~ emailing you now <span className="cursor-blink" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <hr className="divider-cli" />

      {/* CTA */}
      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
          <div className="font-mono-cli text-base text-il-navy">~ access by request</div>
          <h2 className="mt-2 text-3xl font-bold text-il-navy">
            The framework is the product
          </h2>
          <p className="mt-3 text-muted-foreground">
            Weights, thresholds and verdict bands are data you can inspect.
            Reports pin the framework version that scored them. Access is
            granted by request during the preview.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link href="/login" className="btn-cli btn-cli-lg">
              sign in
            </Link>
            <Link href="/login" className="btn-cli-outline btn-cli-lg">
              request access
            </Link>
          </div>
        </div>
      </section>

      {/* Footer — the public page needs the same impersonal, information-not-
          advice framing every entitled surface carries (regulatory posture). */}
      <footer className="border-t-2 border-border bg-il-tint">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Wordmark size="h-8" />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono-cli text-sm text-muted-foreground">
              <Link href="/login" className="hover:text-il-orange">
                sign in
              </Link>
              <Link href="/login" className="hover:text-il-orange">
                request access
              </Link>
              <a href="mailto:hello@investorlogical.com" className="hover:text-il-orange">
                contact
              </a>
            </div>
          </div>
          <p className="mt-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Investorlogical is an experimental exercise. Every desk is an
            autonomous AI agent; all research, scores and verdicts are generated
            by AI models against published frameworks and can be wrong or
            incomplete. Nothing here is investment advice, a recommendation to
            buy or sell, or a promise of accuracy, and none of it accounts for
            anyone&apos;s objectives or circumstances. Figures derive from
            third-party data that may be delayed or incomplete. Capital is at
            risk.
          </p>
          <p className="mt-4 font-mono-cli text-xs text-muted-foreground">
            © {YEAR} Investorlogical — part of the MXMG{" "}
            <span className="text-il-navy">-logical</span> family.
          </p>
        </div>
      </footer>
    </main>
  );
}

// The marketing page is a static server component; a build-time constant keeps
// the footer year current without opting the whole page into dynamic render.
const YEAR = new Date().getFullYear();
