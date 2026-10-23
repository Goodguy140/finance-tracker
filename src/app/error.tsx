"use client";

import { useEffect } from "react";
import { StatusPage } from "@/components/status-page";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusPage
      title="Something went wrong"
      body={`This page couldn't load. Trying again usually fixes it.${error.digest ? ` (Reference ${error.digest})` : ""}`}
    >
      <button
        type="button"
        onClick={() => retry()}
        className="touch-manipulation rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
      >
        Try again
      </button>
    </StatusPage>
  );
}
