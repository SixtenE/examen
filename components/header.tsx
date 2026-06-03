"use client";

import Link from "next/link";
import Image from "next/image";

export function Header() {
  return (
    <header className="bg-background flex w-full items-center p-2 sm:px-0">
      <div className="container mx-auto">
        <nav className="flex w-full items-center">
          <Link href="/" className="rounded-full">
            <Image
              src="/Frame 5.svg"
              alt="Logo"
              width={160}
              height={60}
              unoptimized
              className="text-brand h-10 w-auto"
            />
          </Link>
        </nav>
      </div>
    </header>
  );
}
