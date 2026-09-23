import type { Metadata, Viewport } from "next";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import { PWA_BACKGROUND_COLOR } from "@/lib/pwa-theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finance Tracker",
  description: "Track expenses, budgets, recurring transactions, income, and investment contributions.",
  // iOS reads none of the manifest's display settings; these are its equivalents.
  // `black-translucent` draws the page under the status bar, which is why headers pad
  // with `env(safe-area-inset-top)`.
  appleWebApp: {
    capable: true,
    title: "Finances",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: PWA_BACKGROUND_COLOR,
  colorScheme: "dark",
  // Android Chrome: shrink the layout when the keyboard opens, so the fixed bottom sheets
  // move above it instead of being covered. (iOS ignores this and pans instead.)
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full bg-slate-950 antialiased">
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100">
        <OfflineBanner />
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
