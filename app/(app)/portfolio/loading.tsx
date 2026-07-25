import {
  SkeletonPage,
  SkeletonPageHead,
  SkeletonRows,
  Skeleton,
} from "@/components/skeleton";

export default function PortfolioLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHead />

      {/* totals strip — value / day change / unrealised */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card-cli p-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-7 w-32" />
          </div>
        ))}
      </div>

      {/* holdings */}
      <div className="mt-8">
        <Skeleton className="h-5 w-32" />
        <div className="mt-3">
          <SkeletonRows count={5} />
        </div>
      </div>

      {/* what changed */}
      <div className="mt-8">
        <Skeleton className="h-5 w-48" />
        <div className="mt-3">
          <SkeletonRows count={3} />
        </div>
      </div>
    </SkeletonPage>
  );
}
