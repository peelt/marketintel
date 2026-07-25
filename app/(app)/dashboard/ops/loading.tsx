import {
  SkeletonPage,
  SkeletonPageHead,
  SkeletonRows,
  Skeleton,
} from "@/components/skeleton";

export default function OpsLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHead />
      <div className="mt-8">
        <Skeleton className="h-5 w-40" />
        <div className="mt-3">
          <SkeletonRows count={4} />
        </div>
      </div>
    </SkeletonPage>
  );
}
