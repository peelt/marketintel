import Link from "next/link";
import { agentRegistry } from "@/lib/agents/registry";
import { CliTitleBar, Star, Wordmark, MODULE_COLORS } from "@/components/cli";
import { CliTyping } from "@/components/cli-typing";
import type { AgentName } from "@/lib/agents/types";

export default function Home() {
  const agents = agentRegistry.list();

  return (
    <main>
      {/* Hero */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-baseline justify-between">
            <Wordmark size="h-12" />
            <span className="hidden font-mono-cli text-sm text-muted-foreground sm:inline">
              guest@investorlogical:~
            </span>
          </div>
        </div>
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[5fr_7fr] lg:px-8">
          <div>
            <CliTyping text="~ initialising research desk… [OK]" className="text-base text-il-navy" />
            <span className="tag-cli mt-4 inline-flex">evidence-backed · glass-box</span>
            <h1 className="mt-4 text-4xl font-bold text-il-navy lg:text-6xl">
              Glass-box investment research
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Scheduled specialist desks screen and score the market against
              frameworks you can see in full. Every verdict links to the
              evidence behind it — nothing assumed, nothing advised. Add the
              names you own and each run tells you what changed.
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
            <div className="space-y-2 p-6 font-mono-cli text-base text-il-navy">
              <div className="text-muted-foreground">~ run reaction --screen sp500,ftse350</div>
              <div>
                <Star /> 3 drops cleared the threshold this session
              </div>
              <div>
                <Star /> NXT.L −14.2% · verdict: mild_overshoot · 6 sources cited
              </div>
              <div>
                <Star /> coverage 82% · framework v1 · evidence attached
              </div>
              <div className="text-muted-foreground">
                ~ done in 214s <span className="cursor-blink" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <hr className="divider-cli" />

      {/* Agents */}
      <section className="bg-il-tint">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="font-mono-cli text-base text-il-navy">~ the desk</div>
          <h2 className="mt-2 text-3xl font-bold text-il-navy lg:text-4xl">
            Six specialists, one framework discipline
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((a) => (
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
                  ~ {a.status === "live" ? "live" : "planned"}
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
    </main>
  );
}
