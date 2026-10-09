import { ProfileForm } from "@/components/settings/you-forms";
import { SettingsCard, SettingsPage } from "@/components/settings/ui";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

function initials(displayName: string, email: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (email.split("@")[0] ?? email).slice(0, 2).toUpperCase();
}

export default async function ProfileSettingsPage() {
  const { user } = await requireLoadedUser();
  const joined = user.createdAt.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" });
  return (
    <SettingsPage section="profile">
      <div className="flex items-center gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-500/20 text-lg font-semibold text-blue-50 ring-1 ring-blue-400/25"
          aria-hidden
        >
          {initials(user.displayName, user.email)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-50">{user.displayName.trim() || "Add your name"}</p>
          <p className="truncate text-sm text-slate-400">{user.email}</p>
          <p className="text-xs text-slate-500">Member since {joined}</p>
        </div>
      </div>
      <SettingsCard title="Personal details">
        <ProfileForm
          defaults={{ displayName: user.displayName, countryCode: user.countryCode, timezone: user.timezone }}
        />
      </SettingsCard>
    </SettingsPage>
  );
}
