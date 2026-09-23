"use client";

import { signOut } from "next-auth/react";
import { purgePrivateCaches } from "@/lib/pwa-cache";

/**
 * Client-side sign-out. Drops the offline copy of the dashboard first: `/login` purges it
 * again on arrival, but that redirect can be interrupted (app closed, connection lost).
 */
export async function signOutOfDevice(): Promise<void> {
  await purgePrivateCaches();
  await signOut({ callbackUrl: "/login" });
}
