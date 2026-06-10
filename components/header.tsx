"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";

export function Header() {
  return (
    <header className="bg-background/10 fixed top-0 right-0 left-0 z-50 flex items-center p-2 backdrop-blur-xs sm:px-0">
      <div className="container mx-auto">
        <motion.nav className="flex items-center">
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
                loading="eager"
                className="text-brand h-10 w-auto"
              />
            </motion.div>
          </Link>
        </motion.nav>
      </div>
    </header>
  );
}
