"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardHeader, CardTitle } from "@/components/ui/card";
import Image from "next/image";
import Link from "next/link";
import { queryOptions, useQuery } from "@tanstack/react-query";

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
  return (
    <main className="container mx-auto">
      <h1>Queries</h1>
      <ul className="grid grid-cols-4 gap-4">
        {data?.map((item) => (
          <li key={item.id}>
            <Link href={`/queries/${item.id}`}>
              <CardImage item={item} />
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

function CardImage({
  item,
}: {
  item: { id: string; image_key: string; image_url: string; createdAt: Date };
}) {
  return (
    <Card className="relative mx-auto w-full max-w-sm rounded-sm pt-0">
      <Image
        src={item.image_url}
        alt={item.image_key}
        width={100}
        height={100}
        loading="eager"
        className="relative z-20 aspect-video w-full object-cover"
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
