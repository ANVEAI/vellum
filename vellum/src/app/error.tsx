"use client";

import { useEffect } from "react";
import { withBase } from "@/lib/client/base-path";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="surface max-w-md p-6 text-center">
        <h1 className="t-emph font-semibold">Something went wrong</h1>
        <p className="t-body mt-1.5 text-ink-2">
          {error.message || "An unexpected error occurred while rendering this page."}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" className="btn btn-primary" onClick={reset}>
            Try again
          </button>
          {/*
            Deliberately a raw anchor rather than next/link: this is the error
            boundary, so a full page load is the reliable way out of a broken
            client state — client-side navigation may be exactly what failed.
            That means basePath has to be applied by hand.
          */}
          <a href={withBase("/dashboard")} className="btn btn-secondary">
            Back to library
          </a>
        </div>
      </div>
    </main>
  );
}
