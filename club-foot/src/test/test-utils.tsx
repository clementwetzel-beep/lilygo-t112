import { QueryClient } from '@tanstack/react-query';

/** Client React Query sans retry ni cache : un test doit etre deterministe. */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}
