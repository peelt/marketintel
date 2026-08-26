import {
  SkeletonPage,
  SkeletonPageHead,
  SkeletonRows,
  Skeleton,
} from "@/components/skeleton";

export default function ReportsLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHead />
      {/* latest edition card, then the visible previous-editions list */}
      <div className="card-cli mt-8 px-5 py-4">
        <div className="flex items-baseline justify-between gap-4">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="mt-3 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
      <div className="mt-2">
        <SkeletonRows count={8} />
      </div>
    </SkeletonPage>
  );
}
