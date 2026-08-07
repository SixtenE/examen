"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    posthog.captureException(error, {
      operation: "root_error_boundary",
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <title>Something went wrong — Examen</title>
        <main>
          <h1>Something went wrong</h1>
          <p>An unexpected error occurred.</p>
          <button onClick={unstable_retry}>Try again</button>
        </main>
      </body>
    </html>
  );
}
