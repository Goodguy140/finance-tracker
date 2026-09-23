import type { MetadataRoute } from "next";
import { PWA_BACKGROUND_COLOR } from "@/lib/pwa-theme";

/**
 * Served at `/manifest.webmanifest`, outside the session gate (`src/proxy.ts`): Android
 * fetches it without cookies, so a login redirect here makes the app uninstallable.
 *
 * Icons live in `public/icons/` and come from `scripts/generate-pwa-icons.sh`. iOS ignores
 * this file's icons and uses `src/app/apple-icon.png` instead.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Finance Tracker",
    short_name: "Finances",
    description: "Track expenses, budgets, recurring transactions, income, and investment contributions.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: PWA_BACKGROUND_COLOR,
    theme_color: PWA_BACKGROUND_COLOR,
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
