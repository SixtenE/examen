"use client";

import Link from "next/link";
import Image from "next/image";

export function Header() {
  return (
    <header className="bg-background/10 fixed top-0 right-0 left-0 flex items-center p-2 backdrop-blur-xs sm:px-0">
      <div className="container mx-auto">
        <nav className="flex w-full items-center">
          <Link href="/" className="rounded-full">
            <Image
              src="/logo.svg"
              alt="Logo"
              width={160}
              height={60}
              loading="eager"
              className="text-brand h-10 w-auto"
            />
          </Link>
        </nav>
      </div>
    </header>
  );
}
