import {
  SkeletonPage,
  SkeletonPageHead,
  SkeletonCardGrid,
} from "@/components/skeleton";

export default function ReportsLoading() {
  return (
    <SkeletonPage>
      <SkeletonPageHead />
      <div className="mt-8">
        <SkeletonCardGrid count={6} />
      </div>
    </SkeletonPage>
  );
}
