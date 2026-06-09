"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { useDropzone } from "react-dropzone";
import * as z from "zod";
import { createContext, useContext, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { queryClient } from "@/components/providers";
import { motion } from "motion/react";
import { Input } from "./ui/input";

const formSchema = z.object({
  file: z.instanceof(File),
});

type UploadImageResult = {
  id: string;
  key: string;
};

async function uploadImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Failed to upload file");
  }

  return (await response.json()) as UploadImageResult;
}

function useUploadImage() {
  const router = useRouter();

  return useMutation({
    mutationFn: uploadImage,
    onSuccess: (result) => {
      toast.success("File uploaded successfully");
      queryClient.invalidateQueries({ queryKey: ["queries"] });
      router.push(`/${result.id}`);
    },
    onError: () => {
      toast.error("Failed to upload file");
    },
  });
}

type UploadContextValue = {
  uploadMutation: ReturnType<typeof useUploadImage>;
};

const UploadContext = createContext<UploadContextValue | null>(null);

function useUploadContext() {
  const context = useContext(UploadContext);

  if (!context) {
    throw new Error("UploadForm must be rendered inside UploadForm.Root");
  }

  return context;
}

function UploadFormRoot({ children }: { children: ReactNode }) {
  const uploadMutation = useUploadImage();
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "image/*": [],
    },
    disabled: uploadMutation.isPending,
    multiple: false,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: ([file]) => {
      if (file) {
        uploadMutation.mutate(file);
      }
    },
    onDropRejected: () => {
      toast.error("Drop an image file to upload");
    },
  });

  return (
    <UploadContext.Provider value={{ uploadMutation }}>
      <div {...getRootProps({ className: "min-h-screen" })}>
        <input {...getInputProps()} />
        {(isDragActive || uploadMutation.isPending) && (
          <motion.div
            className="bg-background/80 pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              {uploadMutation.isPending ? (
                <Loader2 className="text-muted-foreground size-10 animate-spin" />
              ) : (
                <Upload className="text-muted-foreground size-10" />
              )}
              <div>
                <p className="text-lg font-semibold">
                  {uploadMutation.isPending
                    ? "Uploading image..."
                    : "Drop image to upload"}
                </p>
                <p className="text-muted-foreground text-sm">
                  {uploadMutation.isPending
                    ? "Hang tight while we process it."
                    : "Release anywhere on the page."}
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {children}
      </div>
    </UploadContext.Provider>
  );
}

function UploadFormCard() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      file: undefined,
    },
  });

  const { uploadMutation } = useUploadContext();

  function onSubmit(data: z.infer<typeof formSchema>) {
    uploadMutation.mutate(data.file, {
      onSuccess: () => form.reset(),
    });
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
                    disabled={uploadMutation.isPending}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      const file = e.target.files?.[0] ?? null;
                      field.onChange(file);

                      if (file) {
                        uploadMutation.mutate(file, {
                          onSuccess: () => form.reset(),
                        });
                      }
                    }}
                  />

                  <p className="text-muted-foreground text-center text-xs">
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

export const UploadForm = Object.assign(UploadFormCard, {
  Root: UploadFormRoot,
});
