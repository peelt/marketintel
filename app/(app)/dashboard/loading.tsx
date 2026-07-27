import { SkeletonPage, SkeletonPageHead, Skeleton } from "@/components/skeleton";

/**
 * Dashboard skeleton — mirrors the real shape so the page doesn't visibly
 * re-flow when it lands: the reaction band (hero, full width, feed left +
 * on-demand form right), then the full-width portfolio card, then the
 * quick-links row.
 *
 * It deliberately does NOT show a newsroom grid: the weekly desks were retired
 * in the 2026-07 scope reduction, so promising five cards here would flash a
 * layout the loaded page no longer has. A skeleton that describes the old
 * product is worse than none — it reads as content that failed to arrive.
 */
export default function DashboardLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHead />

      {/* reaction band */}
      <div className="mt-8">
        <div className="font-mono-cli text-base text-muted-foreground">
          ~ the reaction desk
        </div>
        <div className="card-cli mt-3 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-6 w-44" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="mt-6 grid gap-8 lg:grid-cols-[7fr_5fr]">
            <div className="space-y-3">
              <Skeleton className="h-5 w-40" />
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-5 w-24" />
                </div>
              ))}
            </div>
            <div className="space-y-3 lg:border-l-2 lg:border-border lg:pl-8">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-10/12" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        </div>
      </div>

      {/* your names — one full-width card, same split as the band above */}
      <div className="mt-8">
        <div className="font-mono-cli text-base text-muted-foreground">
          ~ your names
        </div>
        <div className="card-cli mt-3 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="mt-4 grid gap-8 lg:grid-cols-[7fr_5fr]">
            <div className="space-y-3">
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-4 w-64" />
            </div>
            <div className="space-y-3 lg:border-l-2 lg:border-border lg:pl-8">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-8/12" />
            </div>
          </div>
        </div>
        {/* experimental-preview notice */}
        <Skeleton className="mt-6 h-16 w-full" />
      </div>

      <hr className="divider-cli my-10" />

      {/* quick links */}
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card-cli p-6">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-9/12" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
