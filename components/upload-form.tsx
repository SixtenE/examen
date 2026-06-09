"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { useUploadImage } from "@/lib/use-upload-image";
import { motion } from "motion/react";
import { Input } from "./ui/input";

const formSchema = z.object({
  file: z.instanceof(File),
});

export function UploadForm() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      file: undefined,
    },
  });

  const uploadMutation = useUploadImage({
    onSuccess: () => form.reset(),
  });

  function onSubmit(data: z.infer<typeof formSchema>) {
    uploadMutation.mutate(data.file);
  }

  return (
    <div className="bg-card flex h-[226px] w-full flex-col justify-between gap-4 rounded-4xl px-7 py-5">
      <motion.h1
        initial={{ y: -5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="text-lg font-semibold"
      >
        Upload image to analyze
      </motion.h1>

      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <form id="form-upload" onSubmit={form.handleSubmit(onSubmit)}>
          <Controller
            name="file"
            control={form.control}
            render={({ field }) => {
              const { value, ...fieldProps } = field;
              const fileName = value?.name ?? "Choose image";

              return (
                <div className="flex flex-col gap-2">
                  <Button
                    asChild
                    className="w-full rounded-2xl py-6 font-semibold"
                  >
                    <label htmlFor="file">{fileName}</label>
                  </Button>

                  <Input
                    {...fieldProps}
                    id="file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      field.onChange(e.target.files?.[0] ?? null);
                    }}
                  />

                  <p className="text-muted-foreground text-xs">
                    PNG, JPG, JPEG, WEBP Max size: 2MB
                  </p>
                </div>
              );
            }}
          />
        </form>
      </motion.div>
    </div>
  );
}
