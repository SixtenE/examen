"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { useRouter } from "next/navigation";

const formSchema = z.object({
  file: z.instanceof(File),
});

export function UploadForm() {
  const router = useRouter();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      file: undefined,
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      const formData = new FormData();
      formData.append("file", data.file);
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error("Failed to upload file");
      }
      const result = (await response.json()) as { id: string; key: string };

      const matchesResponse = await fetch(`/api/queries/${result.id}/matches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!matchesResponse.ok) {
        throw new Error("Failed to find matches");
      }

      return result;
    },
    onSuccess: (result) => {
      toast.success(`File uploaded successfully: ${result.id}`);
      form.reset();
      router.push(`/queries/${result.id}`);
    },
    onError: () => {
      toast.error("Failed to upload file");
    },
  });

  function onSubmit(data: z.infer<typeof formSchema>) {
    uploadMutation.mutate(data);
  }

  return (
    <Card className="w-full sm:max-w-md">
      <CardHeader>
        <CardTitle>Upload Image</CardTitle>
        <CardDescription>Upload an image to the database.</CardDescription>
      </CardHeader>
      <CardContent>
        <form id="form-upload" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Controller
              name="file"
              control={form.control}
              render={({ field, fieldState }) => {
                const { value, ...fieldProps } = field;
                void value;
                return (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="form-rhf-demo-file">
                      Upload an image
                    </FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        {...fieldProps}
                        id="form-rhf-demo-file"
                        placeholder="Upload an image"
                        type="file"
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          field.onChange(e.target.files?.[0] ?? null);
                        }}
                      />
                    </InputGroup>
                    <FieldDescription>
                      Upload an image to the database.
                    </FieldDescription>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                );
              }}
            />
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Field orientation="horizontal">
          <Button
            type="button"
            variant="outline"
            onClick={() => form.reset()}
            disabled={uploadMutation.isPending || !form.formState.isValid}
          >
            Reset
          </Button>
          <Button
            type="submit"
            form="form-upload"
            disabled={uploadMutation.isPending}
          >
            {uploadMutation.isPending ? "Loading..." : "Submit"}
          </Button>
        </Field>
      </CardFooter>
    </Card>
  );
}
