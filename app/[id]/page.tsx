"use client";

import Link from "next/link";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowUpRight, ChevronLeft } from "lucide-react";
import { motion } from "motion/react";
import { listItem, staggerContainer } from "@/lib/motion";
import { notFound, useParams } from "next/navigation";
import Image from "next/image";
import { useEffect, useRef } from "react";
import type { MatchItem, QueryDetail } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/delete-dialog";
import {
  getApiErrorMessage,
  isRateLimitError,
  throwApiError,
} from "@/lib/api-errors";
import { toast } from "sonner";

const MATCH_SKELETON_COUNT = 9;

class NotFoundError extends Error {
  constructor() {
    super("Not found");
    this.name = "NotFoundError";
  }
}

const matchQueryOptions = (id: string) =>
  queryOptions<MatchItem[]>({
    queryKey: ["matches", id],
    queryFn: async () => {
      const res = await fetch(`/api/queries/${id}/matches`);
      if (res.status === 404) throw new NotFoundError();
      await throwApiError(res, "Failed to fetch matches");
      return res.json();
    },
    refetchInterval: (query) =>
      query.state.data && query.state.data.length > 0 ? false : 500,
    retry: (failureCount, error) =>
      !isRateLimitError(error) && failureCount < 3,
  });

const queryQueryOptions = (id: string) =>
  queryOptions<QueryDetail>({
    queryKey: ["query", id],
    queryFn: async () => {
      const res = await fetch(`/api/queries/${id}`);
      if (res.status === 404) throw new NotFoundError();
      await throwApiError(res, "Failed to fetch query");
      return res.json();
    },
    retry: (failureCount, error) =>
      !isRateLimitError(error) && failureCount < 3,
  });

function MatchItemSkeleton() {
  return (
    <li>
      <div className="bg-card flex h-28 w-full animate-pulse rounded-4xl p-2">
        <div className="bg-muted aspect-square h-full w-auto rounded-2xl" />
        <div className="flex w-full flex-col justify-between gap-2 py-3 pr-3 pl-5">
          <div className="flex items-center justify-between gap-2">
            <div className="bg-muted h-8 w-3/4 rounded" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="bg-muted h-7 w-24 rounded" />
            <div className="bg-muted h-5 w-12 rounded-full" />
          </div>
        </div>
      </div>
    </li>
  );
}

function MatchBadge({ score }: { score: number }) {
  const percentage = Math.round(Math.min(Math.max(score, 0), 1) * 100);
  const hue = percentage * 1.2;
  const style = {
    backgroundColor: `hsl(${hue} 70% 90%)`,
    color: `hsl(${hue} 70% 25%)`,
  };

  return (
    <>
      <Badge
        className="hidden tracking-normal xl:block"
        variant="secondary"
        style={style}
      >
        {percentage}% match
      </Badge>
      <Badge
        className="tracking-normal xl:hidden"
        variant="secondary"
        style={style}
      >
        {percentage}%
      </Badge>
    </>
  );
}

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data, error: queryError } = useQuery(queryQueryOptions(id));

  const matchesQuery = matchQueryOptions(id);
  const { data: matchesData, error: matchesError } = useQuery(matchesQuery);

  const hasStartedMatch = useRef(false);

  const { mutate: createMatch } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/queries/${id}/matches`, { method: "POST" });
      await throwApiError(res, "Failed to start matching");
      return res.json();
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to start matching"));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: matchesQuery.queryKey });
      queryClient.invalidateQueries({
        queryKey: queryQueryOptions(id).queryKey,
      });
    },
  });

  useEffect(() => {
    if (!data || hasStartedMatch.current) return;
    if (data.status !== "pending" && data.status !== "failed") return;

    hasStartedMatch.current = true;
    createMatch();
  }, [data, createMatch]);

  useEffect(() => {
    if (queryError) {
      toast.error(getApiErrorMessage(queryError, "Failed to fetch query"));
    }
  }, [queryError]);

  useEffect(() => {
    if (matchesError) {
      toast.error(getApiErrorMessage(matchesError, "Failed to fetch matches"));
    }
  }, [matchesError]);

  if (queryError && !isRateLimitError(queryError)) notFound();
  if (matchesError && !isRateLimitError(matchesError)) notFound();

  return (
    <main className="container mx-auto flex flex-col gap-0.5 px-2 pt-16 pb-64">
      <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-3">
        <div className="bg-card flex h-fit w-full flex-col justify-between gap-4 rounded-4xl p-5">
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/">
                <ChevronLeft className="size-6" />
              </Link>
            </Button>
            {data ? (
              <motion.h1
                initial={{ y: -5, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="line-clamp-1 text-xl font-semibold"
              >
                {data.title}
              </motion.h1>
            ) : (
              <div className="bg-muted h-6 w-1/2 animate-pulse rounded" />
            )}
            {data ? (
              <DeleteDialog id={data.id} />
            ) : (
              <div className="bg-muted size-8 shrink-0 animate-pulse rounded" />
            )}
          </div>
          {data ? (
            <Image
              src={data.image_url}
              alt="Image"
              width={1500}
              height={1500}
              sizes="(max-width: 640px) 100vw, 33vw"
              priority
              className="bg-muted aspect-square h-auto w-full rounded-lg object-cover"
            />
          ) : (
            <div className="bg-muted aspect-square h-auto w-full animate-pulse rounded-lg object-cover" />
          )}
        </div>

        <motion.ul
          className="col-span-2 grid grid-cols-1 gap-0.5 lg:grid-cols-2"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          {matchesData === undefined || matchesData.length === 0
            ? Array.from({ length: MATCH_SKELETON_COUNT }, (_, index) => (
                <MatchItemSkeleton key={`skeleton-${index}`} />
              ))
            : matchesData.map((match, index) => (
                <motion.li
                  key={match.id}
                  variants={listItem}
                  initial="hidden"
                  animate="show"
                  custom={index + 1}
                  tabIndex={-1}
                  whileHover={{ opacity: 0.8 }}
                  whileTap={{
                    scale: 0.98,
                    transition: { type: "spring", stiffness: 400, damping: 30 },
                  }}
                >
                  <Link
                    href={`https://www.auctionet.com/${match.auctionet_id}`}
                    target="_blank"
                    className="bg-card flex h-28 w-full rounded-4xl"
                  >
                    <Image
                      src={match.image_url}
                      alt="Image"
                      width={500}
                      height={500}
                      sizes="(max-width: 1024px) 50vw, 25vw"
                      className="pointer-events-none aspect-square h-full w-auto rounded-4xl object-cover p-2"
                    />
                    <div className="flex w-full flex-col justify-between gap-2 py-5 pr-5 pl-3">
                      <div className="flex justify-between gap-2">
                        <motion.p
                          initial={{ y: -5, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={{ delay: 0.05 * (index + 1) }}
                          className="text-muted-foreground line-clamp-2 w-3/4 text-sm font-medium tracking-tight"
                        >
                          {match.title}
                        </motion.p>
                        <ArrowUpRight className="text-muted-foreground" />
                      </div>
                      <motion.p
                        initial={{ y: 5, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.05 * (index + 1) }}
                        className="line-clamp-1 flex items-center justify-between gap-2 text-2xl font-semibold tracking-tighter"
                      >
                        {match.price} {match.currency}
                        <MatchBadge score={match.similarity_score} />
                      </motion.p>
                    </div>
                  </Link>
                </motion.li>
              ))}
        </motion.ul>
      </div>
    </main>
  );
}
