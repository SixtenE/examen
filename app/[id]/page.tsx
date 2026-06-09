"use client";

import Link from "next/link";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { listItem, staggerContainer } from "@/lib/motion";
import { useParams } from "next/navigation";
import Image from "next/image";
import { useEffect } from "react";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const { data } = useQuery(
    queryOptions<{
      id: string;
      image_url: string;
    }>({
      queryKey: ["query", id],
      queryFn: () => fetch(`/api/queries/${id}`).then((res) => res.json()),
    }),
  );

  const { data: matchesData } = useQuery(
    queryOptions<
      {
        id: string;
        auctionet_id: string;
        similarity_score: number;
      }[]
    >({
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

  if (!matchesData) return null;

  return (
    <main className="container mx-auto flex flex-col gap-0.5 px-2 pt-20 pb-64">
      <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
        <div className="bg-card flex h-full w-full flex-col justify-between gap-4 rounded-4xl px-7 py-5">
          <motion.h1
            initial={{ y: -5, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-lg font-semibold"
          >
            Image {id}
          </motion.h1>
          {data?.image_url && (
            <Image
              src={data.image_url}
              alt="Image"
              width={100}
              height={100}
              className="asdasdas"
            />
          )}
        </div>

        <motion.ul
          className="grid grid-cols-1 gap-0.5"
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
                  className="bg-card flex h-28 w-full gap-4 rounded-4xl py-5 pr-5 pl-7"
                >
                  <Image
                    src="https://images.auctionet.com/uploads/item_1436318_a4690f2d76.jpg"
                    alt="Image"
                    width={100}
                    height={100}
                    className="aspect-square rounded-xl"
                  />
                  <div className="flex w-full flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <motion.p
                        initial={{ y: -5, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.05 * (index + 1) }}
                        className="text-muted-foreground text-sm font-medium tracking-tight"
                      >
                        {match.auctionet_id}
                      </motion.p>
                      <ArrowUpRight className="text-muted-foreground" />
                    </div>
                    <motion.p
                      initial={{ y: 5, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.05 * (index + 1) }}
                      className="text-2xl font-semibold tracking-tighter"
                    >
                      {`${Math.round(match.similarity_score * 100)}% match`}
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
