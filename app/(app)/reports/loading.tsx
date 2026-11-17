import { EditionSkeleton } from "./edition-skeleton";

/** Both reports routes render the same edition view, so they load alike. */
export default function ReportsLoading() {
  return <EditionSkeleton />;
}
