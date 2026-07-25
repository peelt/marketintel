/**
 * Skeleton loading primitives — the `-logical` family standard, in
 * Manifesto-White CLI dress.
 *
 * These render inside `loading.tsx` files, which is what makes a click on a
 * nav link produce something INSTANTLY. Without a loading file, the App Router
 * blocks on the full server render of a dynamic page before painting anything,
 * so the old page just sits there and the click reads as ignored.
 *
 * House rules for skeletons here:
 *  - mirror the real layout's shape and rhythm, so content landing doesn't
 *    shove the page around;
 *  - never fake DATA (no placeholder numbers or tickers that could be mistaken
 *    for a real score) — bars only;
 *  - keep the mono `~ loading…` eyebrow, so the CLI voice is unbroken.
 */

/** A single shimmering bar. `w`/`h` are Tailwind classes. */
export function Skeleton({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`skeleton-cli rounded-[3px] ${className}`}
    />
  );
}

/** Page title block: eyebrow + heading + explainer paragraph. */
export function SkeletonPageHead() {
  return (
    <div>
      <div className="font-mono-cli text-base text-muted-foreground">
        ~ loading<span className="cursor-blink" />
      </div>
      <Skeleton className="mt-3 h-8 w-64 max-w-full" />
      <div className="mt-4 space-y-2">
        <Skeleton className="h-4 w-full max-w-3xl" />
        <Skeleton className="h-4 w-11/12 max-w-2xl" />
      </div>
    </div>
  );
}

/** One desk/summary card body. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card-cli p-6">
      <div className="flex items-baseline justify-between gap-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="mt-4 space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-5 h-4 w-36" />
    </div>
  );
}

/** A grid of cards — the newsroom/reports shape. */
export function SkeletonCardGrid({ count = 5 }: { count?: number }) {
  return (
    <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** Tabular rows — holdings, ranked tables. */
export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="card-cli divide-y-2 divide-border p-0">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-40 max-w-full" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0" />
          <Skeleton className="hidden h-5 w-20 shrink-0 sm:block" />
        </div>
      ))}
    </div>
  );
}

/** Long-form prose block — report bodies, memos. */
export function SkeletonProse({ paragraphs = 3 }: { paragraphs?: number }) {
  return (
    <div className="space-y-6">
      {Array.from({ length: paragraphs }).map((_, p) => (
        <div key={p} className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-10/12" />
          <Skeleton className="h-4 w-8/12" />
        </div>
      ))}
    </div>
  );
}

/** Standard page frame for a loading state (the shell is already painted). */
export function SkeletonPage({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}
