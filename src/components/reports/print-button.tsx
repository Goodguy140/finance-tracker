"use client";

import { Printer } from "lucide-react";

/** Opens the browser's print dialog for the page on screen. */
export function PrintButton({ className }: { className: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      <Printer className="h-4 w-4" aria-hidden />
      Print
    </button>
  );
}
