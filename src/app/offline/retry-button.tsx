"use client";

import Link from "next/link";
import { primaryBtnClass } from "@/components/forms/shared";

export function RetryButton() {
  return (
    <div className="flex gap-2">
      <button type="button" className={primaryBtnClass} onClick={() => window.location.reload()}>
        Try again
      </button>
      {/* Offline, the RSC fetch fails and Next falls back to a full navigation, which the
          service worker answers from its cached dashboard. */}
      <Link
        href="/"
        prefetch={false}
        className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-blue-300 hover:text-blue-200 sm:min-h-0"
      >
        Open dashboard
      </Link>
    </div>
  );
}
