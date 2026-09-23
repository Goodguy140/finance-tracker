"use client";

import { useEffect } from "react";
import { purgePrivateCaches } from "@/lib/pwa-cache";

/**
 * Mounted on `/login`. Every way a session ends — sign-out, sign-out-everywhere, expiry,
 * revocation — lands there, so this is the one place guaranteed to drop the previous
 * user's cached dashboard before anyone else signs in on the device.
 */
export function PurgePrivateCache() {
  useEffect(() => {
    void purgePrivateCaches();
  }, []);
  return null;
}
