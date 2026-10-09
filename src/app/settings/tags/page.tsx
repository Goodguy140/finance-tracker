import { SettingsPage } from "@/components/settings/ui";
import { TagsPanel } from "@/components/settings/tags-panel";
import { prisma } from "@/lib/prisma";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TagsSettingsPage() {
  const { user } = await requireLoadedUser();
  const tags = await prisma.tag.findMany({
    where: { userId: user.id },
    orderBy: { nameKey: "asc" },
    select: { id: true, name: true, _count: { select: { transactions: true } } },
  });
  return (
    <SettingsPage section="tags">
      <TagsPanel tags={tags.map((t) => ({ id: t.id, name: t.name, transactionCount: t._count.transactions }))} />
    </SettingsPage>
  );
}
