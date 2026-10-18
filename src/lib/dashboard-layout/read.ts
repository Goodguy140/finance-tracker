import { prisma } from "@/lib/prisma";

/**
 * A user's stored dashboard layout, as saved; null for a user who has not touched their
 * dashboard. Turn it into something renderable with `reconcileDashboardLayout`, which never
 * throws and falls back to the default.
 *
 * Read on its own so the dashboard can start it first: whether a card is on the dashboard
 * decides whether its data is worth loading at all.
 */
export async function readDashboardLayoutJson(userId: string): Promise<string | null> {
  const row = await prisma.dashboardLayout.findUnique({
    where: { userId },
    select: { layoutJson: true },
  });
  return row?.layoutJson ?? null;
}
