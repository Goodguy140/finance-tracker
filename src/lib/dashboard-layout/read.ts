import { prisma } from "@/lib/prisma";
import { reconcileDashboardLayout, type ReconciledLayout } from "./normalize";
import type { DashboardCardId } from "./schema";

/**
 * Load a user's dashboard layout and reconcile it against the cards this render actually
 * produced. Never throws and never needs a row to exist: a user who has not touched their
 * dashboard gets the default.
 */
export async function readDashboardLayout(
  userId: string,
  available: readonly DashboardCardId[],
): Promise<ReconciledLayout> {
  const row = await prisma.dashboardLayout.findUnique({
    where: { userId },
    select: { layoutJson: true },
  });
  return reconcileDashboardLayout(row?.layoutJson ?? null, available);
}
