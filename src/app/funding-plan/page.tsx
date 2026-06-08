import Link from "next/link";
import { requireCurrentUserId } from "@/server/currentUser";
import { getFundingPlanEditorData } from "@/server/services/fundingPlanService";
import { FundingPlanEditor } from "@/components/FundingPlanEditor";

export const dynamic = "force-dynamic";

export default async function FundingPlanPage() {
  const userId = await requireCurrentUserId();
  const data = await getFundingPlanEditorData(userId);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-sm text-muted hover:underline">
          ← Back to dashboard
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Funding plan</h1>
        <p className="text-sm text-muted">
          When you add a paycheck with auto-disperse on, new money is split by these percentages —
          first across categories, then across each category&apos;s pockets. Anything a category
          can&apos;t place (a sub-100% split, or pockets that are already full) lands in that
          category&apos;s Overflow pocket. Fully funded pockets are skipped automatically.
        </p>
      </div>
      <FundingPlanEditor data={data} />
    </div>
  );
}
