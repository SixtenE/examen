"use client";

import { UploadForm } from "@/components/upload-form";
import { motion } from "motion/react";
import { enter } from "@/lib/motion";

export default function Home() {
  return (
    <main className="container mx-auto flex flex-col gap-8 px-2">
      <motion.h1
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        transition={enter}
        className="mr-auto text-2xl font-bold"
      >
        Upload
      </motion.h1>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={enter}
        className="flex flex-col items-center"
      >
        <UploadForm />
      </motion.div>
    </main>
  );
}
