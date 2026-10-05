"use client";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { RotateCcw } from "lucide-react";
import { useEffect } from "react";
import posthog from "posthog-js";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    posthog.captureException(error, {
      operation: "react_error_boundary",
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="container mx-auto flex h-screen items-center justify-center">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Something went wrong</EmptyTitle>
          <EmptyDescription>An unexpected error occurred.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={reset}>
            Try again
            <RotateCcw />
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  );
}
