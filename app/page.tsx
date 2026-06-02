"use client";

import { UploadForm } from "@/components/upload-form";
import { motion } from "motion/react";
import { enter } from "@/lib/motion";

export default function Home() {
  return (
    <main className="container mx-auto px-4">
      <h1 className="text-center text-2xl font-bold">Upload</h1>
      <motion.div
        className="mt-32 flex flex-col items-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={enter}
      >
        <UploadForm />
      </motion.div>
    </main>
  );
}
