"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { infiniteQueryOptions, useInfiniteQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { listItem, staggerContainer } from "@/lib/motion";
import { UploadForm } from "@/components/upload-form";
import {
  getApiErrorMessage,
  isRateLimitError,
  throwApiError,
} from "@/lib/api-errors";
import { relativeTimeUntilNow } from "@/lib/utils";
import type { QueriesPage } from "@/lib/types";
import { toast } from "sonner";

const PAGE_SIZE = 12;
const INITIAL_SKELETON_COUNT = 11;
const NEXT_PAGE_SKELETON_COUNT = 3;

const queriesInfiniteOptions = infiniteQueryOptions({
  queryKey: ["queries"],
  queryFn: async ({ pageParam }) => {
    const response = await fetch(
      `/api/queries?limit=${PAGE_SIZE}${pageParam ? `&cursor=${pageParam}` : ""}`,
    );
    await throwApiError(response, "Failed to fetch queries");
    return (await response.json()) as QueriesPage;
  },
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  retry: (failureCount, error) =>
    !isRateLimitError(error) && failureCount < 3,
});

function QueryCardSkeleton() {
  return (
    <li className="min-w-0">
      <div className="bg-card flex h-28 w-full animate-pulse flex-col justify-between gap-4 rounded-4xl py-5 pr-5 pl-7">
        <div className="bg-muted h-4 w-20 rounded" />
        <div className="bg-muted h-7 w-3/4 rounded" />
      </div>
    </li>
  );
}

export default function Page() {
  const sentinelRef = useRef<HTMLDivElement>(null);

  const {
    data,
    error,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery(queriesInfiniteOptions);

  const queryList = data?.pages.flatMap((page) => page.items) ?? [];

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    if (error) {
      toast.error(getApiErrorMessage(error, "Failed to fetch queries"));
    }
  }, [error]);

  return (
    <UploadForm.Root>
      <main className="container mx-auto flex flex-col gap-0.5 px-2 pt-16 pb-64">
        <motion.ul
          className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <motion.li key="upload" custom={0} className="row-span-2 min-w-0">
            <UploadForm />
          </motion.li>
          {isLoading
            ? Array.from({ length: INITIAL_SKELETON_COUNT }, (_, index) => (
                <QueryCardSkeleton key={`skeleton-${index}`} />
              ))
            : queryList.map((query, index) => (
                <motion.li
                  key={query.id}
                  variants={listItem}
                  initial="hidden"
                  animate="show"
                  custom={index + 1}
                  className="min-w-0"
                  tabIndex={-1}
                  whileHover={{ opacity: 0.8 }}
                  whileTap={{
                    scale: 0.98,
                    transition: { type: "spring", stiffness: 400, damping: 30 },
                  }}
                >
                  <Link
                    href={`/${query.id}`}
                    className="bg-card flex h-28 w-full flex-col justify-between gap-4 rounded-4xl py-5 pr-5 pl-7"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <motion.p
                        initial={{ y: -5, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.05 * (index + 1) }}
                        className="text-muted-foreground text-sm font-medium tracking-tight"
                      >
                        {relativeTimeUntilNow(query.createdAt)}
                      </motion.p>
                      <ArrowRight className="text-muted-foreground" />
                    </div>
                    <motion.p
                      initial={{ y: 5, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.05 * (index + 1) }}
                      className="text-2xl font-semibold tracking-tighter"
                    >
                      {query.title}
                    </motion.p>
                  </Link>
                </motion.li>
              ))}
        </motion.ul>
        <div ref={sentinelRef} className="w-full">
          {isFetchingNextPage && (
            <ul className="mt-0.5 grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: NEXT_PAGE_SKELETON_COUNT }, (_, index) => (
                <QueryCardSkeleton key={`next-skeleton-${index}`} />
              ))}
            </ul>
          )}
        </div>
      </main>
    </UploadForm.Root>
  );
}
