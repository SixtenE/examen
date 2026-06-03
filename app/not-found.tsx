import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="container mx-auto flex h-screen items-center justify-center">
      <EmptyInputGroup />
    </main>
  );
}

function EmptyInputGroup() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Page Not Found</EmptyTitle>
        <EmptyDescription>
          The page you&apos;re looking for doesn&apos;t exist.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link href="/">
          <Button>
            Go back to home
            <ArrowRight />
          </Button>
        </Link>
      </EmptyContent>
    </Empty>
  );
}
