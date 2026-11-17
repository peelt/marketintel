import Link from "next/link";

/**
 * An unknown report address, shown INSIDE the reports frame — the default 404
 * replaced the whole page, navigator included, leaving no way on from a stale
 * or mistyped link. Reasons are stated, not guessed at: which one applies
 * isn't knowable from a missing row.
 */
export default function ReportNotFound() {
  return (
    <main>
      <div className="font-mono-cli text-base text-il-navy">~ no report at this address</div>
      <h1 className="mt-1 text-3xl font-bold text-il-navy">Report not found</h1>
      <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
        The link may be mistyped, or it points to a report from a desk that has
        since been retired and withdrawn. Every daily edition on file is on the
        calendar.
      </p>
      <p className="mt-4 font-mono-cli text-base">
        <Link href="/reports" className="text-il-accent hover:text-il-orange">
          open the latest edition →
        </Link>
      </p>
    </main>
  );
}
