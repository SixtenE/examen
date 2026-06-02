"use client";

import { UploadForm } from "@/components/upload-form";
import { motion } from "motion/react";

export default function Home() {
  return (
    <main className="container mx-auto">
      <h1>Upload</h1>
      <motion.div
        className="mt-32 flex flex-col items-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <UploadForm />
      </motion.div>
    </main>
  );
}
