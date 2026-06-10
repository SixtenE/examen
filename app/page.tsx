"use client";

import Link from "next/link";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { queryClient } from "@/components/providers";
import { motion } from "motion/react";
import { listItem, staggerContainer } from "@/lib/motion";
import { UploadForm } from "@/components/upload-form";
import { relativeTimeUntilNow } from "@/lib/utils";
import { queries } from "@/db/schema";

type QueryListItem = typeof queries.$inferSelect;

export default function Page() {
  const { data } = useQuery(
    queryOptions<QueryListItem[]>({
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

      const previousQueries = queryClient.getQueryData<QueryListItem[]>([
        "queries",
      ]);

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

  if (!data) return null;

  return (
    <UploadForm.Root>
      <main className="container mx-auto flex flex-col gap-0.5 px-2 pt-20 pb-64">
        <motion.ul
          className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <motion.li
            key="upload"
            variants={listItem}
            initial="hidden"
            animate="show"
            custom={0}
            className="row-span-2 min-w-0"
          >
            <UploadForm />
          </motion.li>
          {data.map((query, index) => (
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
      </main>
    </UploadForm.Root>
  );
}
