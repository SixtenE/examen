"use client";

import Link from "next/link";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { queryClient } from "@/components/providers";
import { motion } from "motion/react";
import { listItem, staggerContainer } from "@/lib/motion";
import { UploadDialog } from "@/components/upload-dialog";
import { useParams } from "next/navigation";

export default function Page() {
  const { id } = useParams<{ id: string }>();

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
                  className="text-muted-foreground text-sm font-medium tracking-tight"
                >
                  {"99% match"}
                </motion.p>
                <ArrowUpRight className="text-muted-foreground" />
              </div>
              <motion.p
                initial={{ y: 5, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.05 * (index + 1) }}
                className="text-2xl font-semibold tracking-tighter"
              >
                {"polished-heirloom"}
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
                  className="text-muted-foreground text-sm font-medium tracking-tight"
                >
                  {"78% match"}
                </motion.p>
                <ArrowUpRight className="text-muted-foreground" />
              </div>
              <motion.p
                initial={{ y: 5, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.05 * (index + 1) }}
                className="text-xl font-semibold tracking-tighter"
              >
                {"polished-heirloom"}
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
                  className="text-muted-foreground text-sm font-medium tracking-tight"
                >
                  {"56% match"}
                </motion.p>
                <ArrowUpRight className="text-muted-foreground" />
              </div>
              <motion.p
                initial={{ y: 5, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.05 * (index + 1) }}
                className="text-lg font-semibold tracking-tighter"
              >
                {"polished-heirloom"}
              </motion.p>
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </main>
  );
}
