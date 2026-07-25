import {
  SkeletonPage,
  SkeletonPageHead,
  SkeletonProse,
  SkeletonRows,
  Skeleton,
} from "@/components/skeleton";

/**
 * Report skeleton — verdict summary, the ranked table, then the body. The
 * report page is the deepest read in the product (report + items + evidence +
 * securities), so it benefits most from painting its shape early.
 */
export default function ReportLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHead />

      {/* verdict summary band */}
      <div className="card-cli mt-6 p-6">
        <Skeleton className="h-4 w-32" />
        <div className="mt-4 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-32" />
        </div>
      </div>

      {/* ranked table */}
      <div className="mt-8">
        <Skeleton className="h-5 w-36" />
        <div className="mt-3">
          <SkeletonRows count={6} />
        </div>
      </div>

      {/* body */}
      <div className="mt-8">
        <Skeleton className="h-5 w-44" />
        <div className="mt-4">
          <SkeletonProse paragraphs={3} />
        </div>
      </div>
    </SkeletonPage>
  );
}
