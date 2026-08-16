/**
 * A prominent, unmissable notice that the whole product is an experimental
 * exercise and the desk's output is AI-generated. Shown at the top of the
 * dashboard and the marketing home — the disclaimer at the foot of report
 * pages carries the full wording; this is the up-front, above-the-fold version.
 */
export function ExperimentalNotice({ className = "" }: { className?: string }) {
  return (
    <aside
      role="note"
      className={`rounded-lg border border-orange/40 bg-orange/5 px-4 py-3 ${className}`}
    >
      <div className="font-mono-cli text-sm font-bold text-il-orange">
        ~ experimental preview · AI-generated
      </div>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        The desk is an autonomous AI agent. All research, scores and verdicts
        are produced by AI models against a framework you can inspect — treat
        them as a starting point for your own judgement, never as fact or
        advice. This is an experimental exercise, not a finished or regulated
        product.
      </p>
    </aside>
  );
}
