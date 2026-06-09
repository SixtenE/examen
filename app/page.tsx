"use client";

import Link from "next/link";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { queryClient } from "@/components/providers";
import { motion } from "motion/react";
import { listItem, staggerContainer } from "@/lib/motion";
import { UploadDialog } from "@/components/upload-dialog";
import { useDropzone } from "react-dropzone";
import { useUploadImage } from "@/lib/use-upload-image";

export default function Page() {
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

  const uploadMutation = useUploadImage();
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "image/*": [],
    },
    disabled: uploadMutation.isPending,
    multiple: false,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: ([file]) => {
      if (file) {
        uploadMutation.mutate(file);
      }
    },
    onDropRejected: () => {
      toast.error("Drop an image file to upload");
    },
  });

  if (!data) return null;

  return (
    <div {...getRootProps({ className: "min-h-screen" })}>
      <input {...getInputProps()} />
      {(isDragActive || uploadMutation.isPending) && (
        <motion.div
          className="bg-background/80 pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="flex flex-col items-center justify-center gap-4 text-center">
            {uploadMutation.isPending ? (
              <Loader2 className="text-muted-foreground size-10 animate-spin" />
            ) : (
              <Upload className="text-muted-foreground size-10" />
            )}
            <div>
              <p className="text-lg font-semibold">
                {uploadMutation.isPending
                  ? "Uploading image..."
                  : "Drop image to upload"}
              </p>
              <p className="text-muted-foreground text-sm">
                {uploadMutation.isPending
                  ? "Hang tight while we process it."
                  : "Release anywhere on the page."}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      <main className="container mx-auto flex flex-col gap-0.5 px-2 pt-20 pb-64">
        <div className="bg-card flex h-48 w-1/3 flex-col justify-between gap-4 rounded-4xl px-7 py-5">
          <motion.h1
            initial={{ y: -5, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-lg font-semibold"
          >
            Upload image to analyze
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <UploadDialog />
          </motion.div>
        </div>
        <motion.ul
          className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          {data.map((query, index) => (
            <motion.li
              key={query.id}
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
    </div>
  );
}
