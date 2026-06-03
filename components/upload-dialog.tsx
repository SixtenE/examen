"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload } from "lucide-react";
import { UploadForm } from "./upload-form";

export function UploadDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="w-full rounded-2xl py-6 font-semibold active:scale-[.97]">
          <Upload />
          Upload
        </Button>
      </DialogTrigger>
      <DialogContent className="ring-0">
        <DialogHeader>
          <DialogTitle>Upload Image</DialogTitle>
        </DialogHeader>
        <UploadForm />
        <DialogDescription className="text-xs">
          PNG, JPG, JPEG, WEBP Max size: 2MB
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
