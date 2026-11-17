import { Skeleton, SkeletonProse, SkeletonRows } from "@/components/skeleton";

/**
 * The edition's shape while it loads — used by BOTH reports routes, since
 * both render the same view. Drawn inside the reports layout, which already
 * supplies the frame and the (still-mounted) navigator, so this is only the
 * edition column: a different frame here made content jump sideways on load.
 * Bars only, never placeholder figures.
 */
export function EditionSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading edition…</span>
      {/* title + edition line */}
      <Skeleton className="h-9 w-72 max-w-full" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      {/* standfirst */}
      <div className="mt-5 space-y-2">
        <Skeleton className="h-4 w-full max-w-3xl" />
        <Skeleton className="h-4 w-11/12 max-w-3xl" />
      </div>

      {/* ranked table */}
      <div className="mt-8">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        <div className="mt-3">
          <SkeletonRows count={7} />
        </div>
      </div>

      {/* body */}
      <div className="mt-8">
        <Skeleton className="h-5 w-44" />
        <div className="mt-4">
          <SkeletonProse paragraphs={2} />
        </div>
      </div>
    </div>
  );
}
