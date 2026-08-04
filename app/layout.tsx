import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { AuthGate } from "@/components/auth-gate";
import { Header } from "@/components/header";
import Providers from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Examen — visual similarity search",
  description:
    "Upload an image and find visually similar catalog references using vector search.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body>
        <ClerkProvider>
          <Providers>
            <Header />
            <AuthGate>{children}</AuthGate>
            <Toaster richColors position="bottom-center" />
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
