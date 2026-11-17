import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { ReportEdition } from "../report-edition";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A specific edition (or on-demand analysis) by id. The edition itself is
 * `ReportEdition`, shared with `/reports`, which shows the latest one.
 */
export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId } = await getSessionContext();
  if (!userId) redirect("/login");
  // A malformed id is a wrong address, not a server error: without this the
  // uuid column rejects the query and the reader gets a 500.
  if (!UUID.test(id)) notFound();
  return <ReportEdition reportId={id} />;
}
