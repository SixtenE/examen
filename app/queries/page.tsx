"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardHeader, CardTitle } from "@/components/ui/card";
import Image from "next/image";
import Link from "next/link";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { TrashIcon } from "lucide-react";
import { toast } from "sonner";
import { queryClient } from "@/components/providers";
import { motion } from "motion/react";

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
    <main className="container mx-auto">
      <h1>Queries</h1>
      <ul className="grid grid-cols-1 gap-4 px-2 sm:grid-cols-4">
        {data?.map((item) => (
          <motion.li
            key={item.id}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
          >
            <Link href={`/queries/${item.id}`}>
              <CardImage item={item} onDelete={deleteMutation.mutate} />
            </Link>
          </motion.li>
        ))}
      </ul>
    </main>
  );
}

function CardImage({
  item,
  onDelete,
}: {
  item: { id: string; image_key: string; image_url: string; createdAt: Date };
  onDelete: (id: string) => void;
}) {
  return (
    <Card className="relative mx-auto w-full max-w-sm rounded-sm pt-0">
      <Button
        size="icon"
        variant="secondary"
        className="absolute top-2 right-2 z-20"
        onClick={(e) => {
          e.preventDefault();
          onDelete(item.id);
        }}
      >
        <TrashIcon className="size-4" />
      </Button>
      <Image
        src={item.image_url}
        alt={item.image_key}
        width={100}
        height={100}
        loading="eager"
        className="relative z-10 aspect-video w-full object-cover"
      />
      <CardHeader>
        <CardAction>
          <Badge variant="secondary">
            {new Date(item.createdAt).toLocaleDateString()}
          </Badge>
        </CardAction>
        <CardTitle className="line-clamp-1 font-mono text-sm">
          {item.image_key}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
