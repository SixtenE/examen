"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { queryClient } from "@/components/providers";

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

export function useUploadImage(options?: {
  onSuccess?: (result: UploadImageResult) => void;
}) {
  const router = useRouter();

  return useMutation({
    mutationFn: uploadImage,
    onSuccess: (result) => {
      toast.success("File uploaded successfully");
      queryClient.invalidateQueries({ queryKey: ["queries"] });
      options?.onSuccess?.(result);
      router.push(`/${result.id}`);
    },
    onError: () => {
      toast.error("Failed to upload file");
    },
  });
}
