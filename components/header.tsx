"use client";

import Link from "next/link";
import Image from "next/image";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";

export function Header() {
  return (
    <header className="bg-background/80 fixed top-0 right-0 left-0 z-50 flex items-center p-2 backdrop-blur-xs sm:px-0">
      <div className="container mx-auto">
        <motion.nav className="flex items-center justify-between">
          <Link href="/" className="rounded-full px-2">
            <motion.div
              whileHover={{ opacity: 0.8 }}
              whileTap={{ scale: 0.98 }}
              tabIndex={-1}
            >
              <Image
                src="/logo.svg"
                alt="Logo"
                width={160}
                height={60}
                sizes="160px"
                priority
                className="text-brand h-10 w-auto"
              />
            </motion.div>
          </Link>
          <div className="flex items-center gap-1">
            <Show when="signed-out">
              <SignInButton mode="modal">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button size="sm">Create account</Button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <UserButton />
            </Show>
          </div>
        </motion.nav>
      </div>
    </header>
  );
}
