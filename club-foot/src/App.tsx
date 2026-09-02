import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { ClubRouteGuard } from '@/components/auth/ClubRouteGuard';
import { ClubLayout } from '@/components/layout/ClubLayout';
import { Spinner } from '@/components/ui/primitives';

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const SelectClubPage = lazy(() => import('@/pages/SelectClubPage'));
const AccueilPage = lazy(() => import('@/pages/club/AccueilPage'));
const PlanningPage = lazy(() => import('@/pages/club/PlanningPage'));
const SondagesPage = lazy(() => import('@/pages/club/SondagesPage'));
const AdministratifPage = lazy(() => import('@/pages/club/AdministratifPage'));
const MessageriePage = lazy(() => import('@/pages/club/MessageriePage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 1000 * 30,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<SelectClubPage />} />

            {/* Tout ce qui est derriere /club/:slug passe par le garde de route.
                Il choisit l'ecran ; la RLS, elle, protege la donnee. */}
            <Route
              path="/club/:slug"
              element={
                <ClubRouteGuard>
                  <ClubLayout />
                </ClubRouteGuard>
              }
            >
              <Route index element={<AccueilPage />} />
              <Route path="planning" element={<PlanningPage />} />
              <Route path="sondages" element={<SondagesPage />} />
              <Route path="administratif" element={<AdministratifPage />} />
              <Route path="messages" element={<MessageriePage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <Toaster position="top-center" richColors />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
