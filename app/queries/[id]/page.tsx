"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, DownloadIcon, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { easeOut, listItem, staggerContainer } from "@/lib/motion";
import { queryClient } from "@/components/providers";

type QueryStatus = "pending" | "processing" | "ready" | "failed";

type QueryData = {
  id: string;
  image_key: string;
  image_url: string;
  status: QueryStatus;
};

type Match = {
  id: string;
  query_id: string;
  auctionet_id: string;
  similarity_score: number;
};

const MATCH_PLACEHOLDERS = Array.from({ length: 6 });

export default function Page() {
  const { id } = useParams<{ id: string }>();

  const {
    data: queryData,
    isLoading: isQueryLoading,
    isError: isQueryError,
  } = useQuery(
    queryOptions<QueryData>({
      queryKey: ["query", id],
      queryFn: () => fetch(`/api/queries/${id}`).then((res) => res.json()),
      // Poll while matching is in flight so observers (refresh / second tab)
      // pick up the result without re-triggering generation.
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "pending" || status === "processing" ? 2000 : false;
      },
    }),
  );

  const status = queryData?.status;

  const { data: matchesData } = useQuery(
    queryOptions<Match[]>({
      queryKey: ["matches", id],
      queryFn: () =>
        fetch(`/api/queries/${id}/matches`).then((res) => res.json()),
      enabled: status === "ready",
    }),
  );

  const { mutate: generateMatches } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/queries/${id}/matches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        // 409 means another caller is already generating; polling resolves it.
        throw new Error(res.status === 409 ? "in-progress" : "failed");
      }
      return (await res.json()) as Match[];
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["matches", id], data);
      queryClient.invalidateQueries({ queryKey: ["query", id] });
    },
    onError: () => {
      // Status now reflects "failed" (or "processing" for 409); the UI follows
      // the query status, so just resync it.
      queryClient.invalidateQueries({ queryKey: ["query", id] });
    },
  });

  // Kick off generation exactly once per fresh (pending) query.
  const triggeredRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (status === "pending" && triggeredRef.current !== id) {
      triggeredRef.current = id;
      generateMatches();
    }
  }, [status, id, generateMatches]);

  const isGenerating = status === "pending" || status === "processing";

  return (
    <main className="container mx-auto">
      <div className="grid h-full grid-cols-1 gap-12 sm:grid-cols-5">
        <div className="col-span-2 flex flex-col gap-4">
          <div className="flex h-10">
            <Link href="/queries">
              <Button variant="ghost">
                <ArrowLeft />
                Back to queries
              </Button>
            </Link>
          </div>
          <motion.div
            className="sticky top-20 flex w-full flex-col items-center gap-4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: easeOut }}
          >
            <Card className="bg-muted aspect-4/3 h-auto w-full rounded-sm">
              <CardContent className="flex h-full items-center justify-center">
                {queryData?.image_url && (
                  <Image
                    src={queryData.image_url}
                    alt={queryData.image_key}
                    width={400}
                    height={300}
                    loading="eager"
                    className="h-full w-full object-cover mix-blend-darken"
                  />
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
        <div className="col-span-3 flex h-full flex-col gap-4">
          <div className="flex h-10 items-center">
            <h2 className="text-md text-muted-foreground font-medium">
              Matches
            </h2>
          </div>
          <MatchesContent
            status={status}
            isGenerating={isGenerating}
            isQueryLoading={isQueryLoading}
            isQueryError={isQueryError}
            matches={matchesData}
            onRetry={() => generateMatches()}
          />
        </div>
      </div>
    </main>
  );
}

function MatchesContent({
  status,
  isGenerating,
  isQueryLoading,
  isQueryError,
  matches,
  onRetry,
}: {
  status: QueryStatus | undefined;
  isGenerating: boolean;
  isQueryLoading: boolean;
  isQueryError: boolean;
  matches: Match[] | undefined;
  onRetry: () => void;
}) {
  if (isQueryError) {
    return (
      <p className="text-muted-foreground text-sm">
        Failed to load this query.
      </p>
    );
  }

  if (isGenerating || isQueryLoading) {
    return (
      <ul className="grid animate-pulse grid-cols-2 gap-4 sm:grid-cols-3">
        {MATCH_PLACEHOLDERS.map((_, index) => (
          <li key={index}>
            <Card className="bg-muted relative aspect-4/3 h-auto w-full rounded-sm p-0"></Card>
          </li>
        ))}
      </ul>
    );
  }

  if (status === "failed") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">
          Something went wrong while finding matches.
        </p>
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (!matches || matches.length === 0) {
    return <p className="text-muted-foreground text-sm">No matches found.</p>;
  }

  return (
    <motion.ul
      className="grid grid-cols-2 gap-4 sm:grid-cols-3"
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      {matches.map((match) => (
        <motion.li
          key={match.id}
          variants={listItem}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        >
          <Link
            href={`https://auctionet.com/${match.auctionet_id}`}
            target="_blank"
            rel="noreferrer"
          >
            <Card className="bg-muted group relative aspect-4/3 h-auto w-full rounded-sm transition-opacity hover:opacity-90">
              <CardContent className="flex h-full flex-col items-center justify-center gap-2 p-4">
                <ExternalLink className="text-muted-foreground absolute top-3 right-3 size-4 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100" />
                <span className="text-sm font-medium">
                  {match.auctionet_id}
                </span>
                <span className="text-muted-foreground text-xs">
                  {(match.similarity_score * 100).toFixed(1)}% similar
                </span>
              </CardContent>
            </Card>
          </Link>
        </motion.li>
      ))}
    </motion.ul>
  );
}
