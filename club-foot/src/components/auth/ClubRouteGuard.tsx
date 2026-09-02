import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useClub } from '@/hooks/useClub';
import { useClubAccess } from '@/hooks/useClubAccess';
import type { ClubRole } from '@/integrations/supabase/types';
import { Spinner } from '@/components/ui/primitives';

interface ClubRouteGuardProps {
  children: ReactNode;
  /** Roles autorises. Par defaut : tout membre du club. */
  requiredRoles?: readonly ClubRole[];
}

/**
 * Protege les routes /club/:slug/*.
 *
 * Deux precautions reprises de Schproutz :
 *  - getSession() (et non getUser()) lit le jeton deja en memoire : aucun
 *    aller-retour reseau avant que le controle d'acces demarre ;
 *  - useClub(slug) est appele ICI pour prechauffer le cache React Query, la
 *    page protegee trouve le club deja resolu au lieu de relancer sa requete.
 *
 * Ce garde choisit l'ECRAN. La donnee, elle, reste protegee par les policies
 * RLS a chaque requete.
 */
export function ClubRouteGuard({ children, requiredRoles }: ClubRouteGuardProps) {
  const { slug } = useParams<{ slug: string }>();
  const [userId, setUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(!!slug);

  useClub(slug);

  useEffect(() => {
    if (!slug) return;

    let annule = false;

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (annule) return;
      if (error) console.error('Session illisible dans le garde de route:', error);
      if (session?.user) setUserId(session.user.id);
      setAuthLoading(false);
    });

    return () => {
      annule = true;
    };
  }, [slug]);

  const { hasAccess, isLoading: accessLoading, error } = useClubAccess(
    slug,
    userId ?? undefined,
    requiredRoles,
  );

  const redirection = useMemo(() => {
    if (authLoading || accessLoading) return null;
    if (!slug) return '/';
    if (!userId) return '/login';
    if (error) {
      console.error("Erreur lors de la verification des acces au club:", error);
      return '/';
    }
    if (!hasAccess) return '/';
    return null;
  }, [authLoading, accessLoading, slug, userId, error, hasAccess]);

  if (authLoading || accessLoading) return <Spinner label="Verification des acces" />;
  if (redirection) return <Navigate to={redirection} replace />;

  return <>{children}</>;
}
