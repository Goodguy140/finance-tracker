"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect } from "react";
import { resolveLegacySettingsHash } from "@/lib/settings-sections";

/**
 * Settings used to be one page of tabs addressed by hash (`/settings#rules`). The hash never
 * reaches the server, so the home page sends those links on to the page that now holds them.
 */
export function LegacyHashRedirect() {
  const router = useRouter();
  useLayoutEffect(() => {
    const target = resolveLegacySettingsHash(window.location.hash);
    if (target) router.replace(target);
  }, [router]);
  return null;
}
