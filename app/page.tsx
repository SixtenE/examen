"use client";

import { UploadForm } from "@/components/upload-form";
import { motion } from "motion/react";
import { enter } from "@/lib/motion";
import FileUpload03 from "@/components/file-upload-03";

export default function Home() {
  return (
    <main className="container mx-auto flex flex-col gap-8 px-2">
      <motion.h1
        initial={{ x: -10, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
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
        <FileUpload03 />
      </motion.div>
    </main>
  );
}
