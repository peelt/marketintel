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
            <Wordmark size="h-9" />
            <span className="hidden font-mono-cli text-xs text-muted-foreground sm:inline">
              guest@investorlogical:~
            </span>
          </div>
        </div>
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[5fr_7fr] lg:px-8">
          <div>
            <CliTyping text="~ initialising research desk… [OK]" className="text-sm text-il-navy" />
            <span className="tag-cli mt-4 inline-flex">evidence-backed · glass-box</span>
            <h1 className="mt-4 text-4xl font-bold text-il-navy lg:text-6xl">
              Research that shows its working
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Scheduled specialist agents file ranked reports against scoring
              frameworks you can see and edit. Every score is defensible from
              the evidence it cites — nothing is a black box.
            </p>
            <div className="mt-8 flex gap-3">
              <Link href="/login" className="btn-cli btn-cli-lg">
                sign in
              </Link>
              <Link href="/reports" className="btn-cli-outline btn-cli-lg">
                view reports
              </Link>
            </div>
          </div>

          {/* Self-framing terminal panel */}
          <div className="card-cli overflow-hidden p-0">
            <CliTitleBar title="~ investorlogical.com/reports" />
            <div className="space-y-2 p-6 font-mono-cli text-sm text-il-navy">
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
          <div className="font-mono-cli text-sm text-il-navy">~ the desk</div>
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
                <div className="mt-4 font-mono-cli text-xs text-muted-foreground">
                  ~ cron {a.schedule}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <hr className="divider-cli" />

      {/* CTA */}
      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
          <div className="font-mono-cli text-sm text-il-navy">~ single-user preview</div>
          <h2 className="mt-2 text-3xl font-bold text-il-navy">
            The framework is the product
          </h2>
          <p className="mt-3 text-muted-foreground">
            Weights, thresholds and verdict bands are data you can inspect.
            Reports pin the framework version that scored them.
          </p>
          <div className="mt-8">
            <Link href="/login" className="btn-cli btn-cli-lg">
              sign in
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
