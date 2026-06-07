"use client";

import Link from "next/link";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { queryClient } from "@/components/providers";
import { motion } from "motion/react";
import { listItem, staggerContainer } from "@/lib/motion";
import { UploadDialog } from "@/components/upload-dialog";
import { useParams } from "next/navigation";
import Image from "next/image";

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
  return (
    <main className="container mx-auto flex flex-col gap-0.5 px-2 pt-20 pb-64">
      <motion.ul
        className="grid grid-cols-1 gap-0.5 sm:grid-cols-12"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        <motion.li
          key="upload"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="col-span-6 row-span-4"
        >
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
        </motion.li>
        {Array.from({ length: 1 }).map((_, index) => (
          <motion.li
            key={index}
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
            className="col-span-6"
          >
            <Link
              href={`/${index}`}
              className="bg-card flex h-28 w-full flex-col justify-between gap-4 rounded-4xl py-5 pr-5 pl-7"
            >
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
                {/* <ArrowUpRight className="text-muted-foreground" /> */}
              </div>
              <motion.p
                initial={{ y: 5, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.05 * (index + 1) }}
                className="animate-pulse text-2xl font-semibold tracking-tighter"
              >
                {"Loading..."}
              </motion.p>
            </Link>
          </motion.li>
        ))}
        {Array.from({ length: 2 }).map((_, index) => (
          <motion.li
            key={index}
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
            className="col-span-3"
          >
            <Link
              href={`/${index}`}
              className="bg-card flex h-28 w-full flex-col justify-between gap-4 rounded-4xl py-5 pr-5 pl-7"
            >
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
                {/* <ArrowUpRight className="text-muted-foreground" /> */}
              </div>
              <motion.p
                initial={{ y: 5, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.05 * (index + 1) }}
                className="animate-pulse text-xl font-semibold tracking-tighter"
              >
                {"Loading..."}
              </motion.p>
            </Link>
          </motion.li>
        ))}
        {Array.from({ length: 3 }).map((_, index) => (
          <motion.li
            key={index}
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
            className="col-span-2"
          >
            <Link
              href={`/${index}`}
              className="bg-card flex h-28 w-full flex-col justify-between gap-4 rounded-4xl py-5 pr-5 pl-7"
            >
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
                {/* <ArrowUpRight className="text-muted-foreground" /> */}
              </div>
              <motion.p
                initial={{ y: 5, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.05 * (index + 1) }}
                className="animate-pulse text-lg font-semibold tracking-tighter"
              >
                {"Loading..."}
              </motion.p>
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </main>
  );
}
