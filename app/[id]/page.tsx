"use client";

import Link from "next/link";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { listItem, staggerContainer } from "@/lib/motion";
import { useParams } from "next/navigation";
import Image from "next/image";
import { useEffect } from "react";
import { matches, queries } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/delete-dialog";

type QueryData = typeof queries.$inferSelect & { image_url: string };

type MatchData = typeof matches.$inferSelect;

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const { data } = useQuery(
    queryOptions<QueryData>({
      queryKey: ["query", id],
      queryFn: () => fetch(`/api/queries/${id}`).then((res) => res.json()),
    }),
  );

  const { data: matchesData } = useQuery(
    queryOptions<MatchData[]>({
      queryKey: ["matches", id],
      queryFn: () =>
        fetch(`/api/queries/${id}/matches`).then((res) => res.json()),
    }),
  );

  const matchesMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/queries/${id}/matches`, { method: "POST" }).then((res) =>
        res.json(),
      ),
    onSuccess: (data) => {
      console.log(data);
    },
  });

  useEffect(() => {
    matchesMutation.mutate();
  }, []);

  if (!matchesData || !data) return null;

  return (
    <main className="container mx-auto flex flex-col gap-0.5 px-2 pt-20 pb-64">
      <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-3">
        <div className="bg-card flex h-fit w-full flex-col justify-between gap-4 rounded-4xl p-5">
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/">
                <ArrowLeft className="size-6 stroke-2" />
              </Link>
            </Button>
            <motion.h1
              initial={{ y: -5, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="line-clamp-1 text-xl font-semibold"
            >
              {data.title}
            </motion.h1>
            <DeleteDialog id={data.id} />
          </div>
          {data.image_url && (
            <Image
              src={data.image_url}
              alt="Image"
              width={1500}
              height={1500}
              className="aspect-square h-auto w-full rounded-lg object-cover"
              loading="eager"
            />
          )}
        </div>

        <motion.ul
          className="col-span-2 grid grid-cols-1 gap-0.5 lg:grid-cols-2"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          {matchesData == undefined ? (
            <>
              {Array.from({ length: 4 }).map((_, index) => (
                <li key={`loading-${index}`} className="">
                  <div className="bg-card flex h-28 w-full flex-col justify-between gap-4 rounded-4xl py-5 pr-5 pl-7">
                    <div className="flex items-center justify-between gap-2">
                      <motion.p
                        initial={{ y: -5, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.05 * (index + 1) }}
                        className="text-muted-foreground animate-pulse text-sm font-medium tracking-tight"
                      >
                        {"Loading..."}
                      </motion.p>
                      <Loader2 className="text-muted-foreground animate-spin" />
                    </div>
                    <motion.p
                      initial={{ y: 5, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.05 * (index + 1) }}
                      className="animate-pulse text-2xl font-semibold tracking-tighter"
                    >
                      {"Loading..."}
                    </motion.p>
                  </div>
                </li>
              ))}
            </>
          ) : (
            matchesData.map((match, index) => (
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
                className=""
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
                    className="pointer-events-none aspect-square h-full w-auto rounded-4xl object-cover p-2"
                    loading="eager"
                  />
                  <div className="flex w-full flex-col gap-2 py-5 pr-5 pl-3">
                    <div className="flex items-center justify-between gap-2">
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
                      className="flex items-center gap-2 text-2xl font-semibold tracking-tighter"
                    >
                      {match.price} {match.currency}
                      <Badge
                        className="tracking-normal"
                        variant="secondary"
                      >{`${Math.round(match.similarity_score * 100)}% match`}</Badge>
                    </motion.p>
                  </div>
                </Link>
              </motion.li>
            ))
          )}
        </motion.ul>
      </div>
    </main>
  );
}
