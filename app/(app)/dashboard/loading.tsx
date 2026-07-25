import {
  SkeletonPage,
  SkeletonPageHead,
  SkeletonCardGrid,
  Skeleton,
} from "@/components/skeleton";

/**
 * Dashboard skeleton — mirrors the real shape: status strip, the full-width
 * Reaction band (hero), then the newsroom grid. The dashboard is the heaviest
 * page (desk cards + portfolio + intel + telemetry), so this is where a
 * loading state matters most.
 */
export default function DashboardLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHead />

      {/* status strip */}
      <div className="mt-6 flex flex-wrap gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-6 w-44" />
      </div>

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

      {/* newsroom */}
      <div className="mt-8">
        <div className="font-mono-cli text-base text-muted-foreground">
          ~ the newsroom
        </div>
        <SkeletonCardGrid count={5} />
      </div>
    </SkeletonPage>
  );
}
