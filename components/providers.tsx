"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, avoid refetching immediately on the client for data
        // that was just prefetched/rendered on the server.
        staleTime: 60 * 1000,
      },
    },
  });
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = makeQueryClient();

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
