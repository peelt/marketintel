import {
  SkeletonPage,
  SkeletonPageHead,
  SkeletonRows,
} from "@/components/skeleton";

export default function DiagnosticsLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHead />
      <div className="mt-8">
        <SkeletonRows count={6} />
      </div>
    </SkeletonPage>
  );
}
