"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { easeOut, listItem, staggerContainer } from "@/lib/motion";

type Match = {
  id: string;
  query_id: string;
  auctionet_id: string;
  similarity_score: number;
};

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = useParams<{ id: string }>();

  const {
    data: queryData,
    isLoading: isQueryLoading,
    isError: isQueryError,
  } = useQuery(
    queryOptions<{ id: string; image_key: string; image_url: string }>({
      queryKey: ["query", id],
      queryFn: () => fetch(`/api/queries/${id}`).then((res) => res.json()),
    }),
  );
  const {
    data: matchesData,
    isLoading: isMatchesLoading,
    isError: isMatchesError,
  } = useQuery(
    queryOptions<
      {
        id: string;
        query_id: string;
        auctionet_id: string;
        similarity_score: number;
      }[]
    >({
      queryKey: ["matches", id],
      queryFn: () =>
        fetch(`/api/queries/${id}/matches`).then((res) => res.json()),
    }),
  );

  return (
    <main className="container mx-auto">
      <div className="grid h-full grid-cols-1 gap-12 sm:grid-cols-5">
        <div className="col-span-2 flex">
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
                    className="h-full w-full object-cover"
                  />
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
        <div className="col-span-3 flex h-full flex-col gap-4">
          <h2 className="w-full text-lg font-medium">Matches</h2>
          {matchesData?.length === 0 ? (
            <p className="text-muted-foreground text-sm">No matches yet.</p>
          ) : (
            <motion.ul
              className="grid grid-cols-3 gap-4"
              variants={staggerContainer}
              initial="hidden"
              animate="show"
            >
              {matchesData?.map((match: Match) => (
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
          )}
        </div>
      </div>
    </main>
  );
}
