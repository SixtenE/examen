"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
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
import { useUploadImage } from "@/lib/use-upload-image";

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
