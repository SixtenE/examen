"use client";

import { File, Image, ImageIcon, Trash, Upload } from "lucide-react";
import React from "react";
import { useDropzone } from "react-dropzone";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export default function FileUpload03() {
  const [files, setFiles] = React.useState<File[]>([]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => setFiles(acceptedFiles),
  });

  const filesList = files.map((file) => (
    <li key={file.name} className="relative">
      <Card className="relative p-4 shadow-none">
        <div className="absolute top-1/2 right-4 -translate-y-1/2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove file"
            onClick={() =>
              setFiles((prevFiles) =>
                prevFiles.filter((prevFile) => prevFile.name !== file.name),
              )
            }
          >
            <Trash className="h-5 w-5" aria-hidden={true} />
          </Button>
        </div>
        <CardContent className="flex items-center space-x-3 p-0">
          <span className="bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-md">
            <ImageIcon className="text-foreground h-5 w-5" aria-hidden={true} />
          </span>
          <div>
            <p className="text-foreground font-medium text-pretty">
              {file.name}
            </p>
            <p className="text-muted-foreground mt-0.5 text-sm text-pretty">
              {file.size} bytes
            </p>
          </div>
        </CardContent>
      </Card>
    </li>
  ));

  return (
    <div className="flex items-center justify-center">
      <Card className="w-lg shadow-none">
        <CardHeader>
          <CardTitle>Upload image</CardTitle>
        </CardHeader>
        <CardContent>
          <form action="#" method="post">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
              <div className="col-span-full">
                {filesList.length === 0 ? (
                  <div
                    {...getRootProps()}
                    className={cn(
                      isDragActive
                        ? "border-primary bg-primary/10 ring-primary/20 ring-2"
                        : "border-border",
                      "mt-2 flex cursor-pointer justify-center rounded-md border border-dashed px-6 py-20 transition-colors duration-200",
                    )}
                  >
                    <div>
                      <Upload
                        className="text-muted-foreground/80 mx-auto h-12 w-12"
                        aria-hidden={true}
                      />
                      <div className="text-muted-foreground mt-4 flex">
                        <p>Drag and drop or</p>
                        <label
                          htmlFor="file"
                          className="text-primary hover:text-primary/80 relative cursor-pointer rounded-sm pl-1 font-medium hover:underline hover:underline-offset-4"
                        >
                          <span>choose file</span>
                          <input
                            {...getInputProps()}
                            id="file-upload-2"
                            name="file-upload-2"
                            type="file"
                            className="sr-only"
                          />
                        </label>
                        <p className="pl-1 text-pretty">to upload</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <ul role="list" className="mt-4 space-y-4">
                    {filesList}
                  </ul>
                )}
              </div>
            </div>
            {filesList.length > 0 && (
              <>
                <Separator className="my-6" />
                <div className="flex items-center justify-end space-x-3">
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                  <Button type="submit">Upload</Button>
                </div>
              </>
            )}
          </form>
        </CardContent>
        <CardFooter className="flex items-center justify-between">
          <p className="text-muted-foreground text-xs">PNG, JPG, JPEG, WEBP</p>
          <p className="text-muted-foreground text-xs">
            Max. size per file: 2MB
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
