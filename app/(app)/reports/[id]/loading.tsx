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

      {/* standfirst + edition switcher */}
      <div className="mt-4 space-y-2">
        <Skeleton className="h-4 w-full max-w-3xl" />
        <Skeleton className="h-4 w-11/12 max-w-3xl" />
      </div>
      <div className="mt-4 flex gap-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>

      {/* ranked table */}
      <div className="mt-8">
        <Skeleton className="h-5 w-36" />
        <div className="mt-3">
          <SkeletonRows count={7} />
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
