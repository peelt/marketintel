import { Suspense } from "react";
import { EditionNav, EditionNavSkeleton } from "@/components/edition-nav";
import { getErrorMessage } from "@/lib/errors";
import { loadEditionIndex, type EditionIndexes } from "@/lib/reports/edition-index";

/**
 * The reports frame: the edition on the left, the edition navigator beside it
 * (xl and up) or above it (below xl).
 *
 * The navigator is here, not in the edition, so it stays MOUNTED while the
 * edition swaps — the same principle as the app shell. Stepping back three
 * editions keeps keyboard focus on the same button and the calendar on the
 * month you paged to, instead of the whole page (navigator included) being
 * replaced by a skeleton on every step.
 *
 * This layout is synchronous on purpose. A layout sits OUTSIDE its segment's
 * loading.tsx boundary, so an awaited read here would block the first paint
 * of every reports navigation; the navigator loads under its own Suspense.
 *
 * DOM order is navigator-then-edition (so on a phone the bar is on top, and a
 * screen reader meets "Editions" before the edition); at xl the grid places
 * the navigator in the second column and pins it while the edition scrolls.
 */
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 pb-10 pt-6 sm:px-6 xl:grid xl:max-w-[80rem] xl:grid-cols-[minmax(0,56rem)_18rem] xl:justify-center xl:gap-x-8 xl:px-8 xl:pt-10">
      <aside className="xl:sticky xl:top-6 xl:col-start-2 xl:row-start-1 xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto">
        <Suspense fallback={<EditionNavSkeleton />}>
          <EditionNavLoader />
        </Suspense>
      </aside>
      <div className="mt-6 min-w-0 xl:col-start-1 xl:row-start-1 xl:mt-0">{children}</div>
    </div>
  );
}

/**
 * Fail-soft: the navigator is how you MOVE between editions, not the edition.
 * If the index read fails the edition still renders, without it. (On
 * `/reports` itself the page needs the same read to know which edition is the
 * latest, and surfaces that failure itself.)
 */
async function EditionNavLoader() {
  let data: EditionIndexes;
  try {
    data = await loadEditionIndex();
  } catch (err) {
    console.error(`reports navigator: ${getErrorMessage(err)}`);
    return null;
  }
  return <EditionNav indexes={data.indexes} primaryDesk={data.primaryDesk} />;
}
