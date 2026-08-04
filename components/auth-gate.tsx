"use client";

import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function AuthGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <main className="container mx-auto flex min-h-screen items-center justify-center px-4">
          <section className="bg-card flex max-w-lg flex-col items-center gap-6 rounded-4xl p-10 text-center">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tighter">
                Find visually similar auction items
              </h1>
              <p className="text-muted-foreground">
                Sign in to upload an image and search the catalog.
              </p>
            </div>
            <div className="flex gap-2">
              <SignInButton mode="modal">
                <Button>Sign in</Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button variant="outline">Create account</Button>
              </SignUpButton>
            </div>
          </section>
        </main>
      </Show>
    </>
  );
}
