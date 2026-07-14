/**
 * Impersonal-framing disclaimer (invariant I2, POSITIONING §7).
 *
 * Renders on every report surface. The wording is deliberate: scores and
 * classifications describe SECURITIES under a published framework — they are
 * information and probability, never personal advice. Do not soften or
 * personalise this copy.
 */
export function Disclaimer() {
  return (
    <aside role="note" className="bg-il-tint mt-12 rounded-lg border border-border px-5 py-4">
      <div className="font-mono-cli text-xs text-il-navy">~ information, not advice</div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Investorlogical scores securities against published, versioned
        frameworks you can inspect and edit. Rankings, classifications and
        verdicts describe the security under that framework — they are not
        investment advice, not a recommendation to buy or sell, and take no
        account of anyone&apos;s objectives or circumstances. Figures derive
        from third-party data that may be delayed or incomplete; where data is
        missing, scores show reduced coverage rather than a guess. Capital is
        at risk.
      </p>
    </aside>
  );
}
