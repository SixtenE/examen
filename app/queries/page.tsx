"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Image from "next/image";
import Link from "next/link";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  ArrowUpRightIcon,
  Folder,
  ImageIcon,
  MoreHorizontal,
  MoreVertical,
  Plus,
  TrashIcon,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { queryClient } from "@/components/providers";
import { motion } from "motion/react";
import { enter, listItem, staggerContainer } from "@/lib/motion";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { UploadDialog } from "@/components/upload-dialog";

export default function Queries() {
  const { data } = useQuery(
    queryOptions<
      {
        id: string;
        image_key: string;
        image_url: string;
        createdAt: Date;
      }[]
    >({
      queryKey: ["queries"],
      queryFn: () => fetch("/api/queries").then((res) => res.json()),
    }),
  );

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/queries/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to delete query");
      }
      return response.json();
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["queries"] });

      const previousQueries = queryClient.getQueryData<
        { id: string; image_key: string; image_url: string; createdAt: Date }[]
      >(["queries"]);

      queryClient.setQueryData(["queries"], (old: typeof previousQueries) =>
        old?.filter((query) => query.id !== id),
      );

      return { previousQueries };
    },
    onError: (error, id, context) => {
      if (context?.previousQueries) {
        queryClient.setQueryData(["queries"], context.previousQueries);
      }
      toast.error("Failed to delete query");
    },
    onSuccess: () => {
      toast.success("Query deleted");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["queries"] });
    },
  });

  return (
    <main className="container mx-auto flex flex-col gap-0.5 px-2 pt-8 pb-32">
      <motion.ul
        className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-3"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        <motion.li
          key="upload"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="row-span-2"
        >
          <div className="bg-card row-span-2 flex h-full w-full flex-col justify-between gap-4 rounded-4xl px-7 py-5">
            <motion.h1
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="col-span-2 text-xl font-semibold"
            >
              Upload image to analyze
            </motion.h1>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <UploadDialog />
            </motion.div>
          </div>
        </motion.li>
        {data?.map((query, index) => (
          <motion.li
            key={query.id}
            variants={listItem}
            tabIndex={-1}
            whileHover={{ opacity: 0.8 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            <Link
              href={`/queries/${index}`}
              className="bg-card flex h-28 w-full flex-col justify-between gap-4 rounded-4xl py-5 pr-5 pl-7"
            >
              <div className="flex items-center justify-between gap-2">
                <motion.p
                  initial={{ y: -5, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.05 * (index + 1) }}
                  className="text-muted-foreground text-sm font-medium tracking-tight"
                >
                  {"1 day ago"}
                </motion.p>
                <ArrowRight className="text-muted-foreground" />
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
      </motion.ul>
    </main>
  );
}
