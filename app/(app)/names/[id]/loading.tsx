import {
  SkeletonPage,
  SkeletonPageHead,
  SkeletonCard,
  Skeleton,
} from "@/components/skeleton";

export default function NameLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHead />
      <div className="mt-6 flex flex-wrap gap-3">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-6 w-36" />
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </div>
    </SkeletonPage>
  );
}
