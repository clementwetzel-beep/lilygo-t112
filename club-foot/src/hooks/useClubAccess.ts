import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ClubRole } from '@/integrations/supabase/types';
import { resolveClubAccess, type ClubAccess } from '@/lib/access';

export const clubAccessKeys = {
  all: ['clubAccess'] as const,
  bySlug: (slug: string, userId: string) => [...clubAccessKeys.all, slug, userId] as const,
};

export interface ClubAccessResult extends ClubAccess {
  isLoading: boolean;
  error: Error | null;
}

/**
 * Les deux lectures sont INDEPENDANTES : le club (par son slug) et les
 * adhesions de l'utilisateur partent en parallele, le rapprochement se fait
 * en memoire (resolveClubAccess). Enchainer la seconde requete sur l'id
 * renvoye par la premiere ajouterait un aller-retour reseau complet avant
 * meme que la page protegee commence a charger.
 */
async function chargerAcces(slug: string, userId: string): Promise<ClubAccess> {
  const [{ data: club, error: clubError }, { data: memberships, error: memberError }] =
    await Promise.all([
      supabase.from('clubs').select('id, owner_id').eq('slug', slug).single(),
      supabase.from('club_members').select('club_id, role').eq('user_id', userId),
    ]);

  if (clubError || !club) {
    return { hasAccess: false, role: null, clubId: null };
  }

  return resolveClubAccess({
    userId,
    club,
    memberships: memberError ? [] : memberships,
  });
}

export function useClubAccess(
  slug: string | undefined,
  userId: string | undefined,
  requiredRoles?: readonly ClubRole[],
): ClubAccessResult {
  const { data, isLoading, error } = useQuery({
    queryKey: clubAccessKeys.bySlug(slug ?? '', userId ?? ''),
    queryFn: () => chargerAcces(slug!, userId!),
    enabled: !!slug && !!userId,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const role = data?.role ?? null;
  const autorise = (data?.hasAccess ?? false) && (!requiredRoles || (!!role && requiredRoles.includes(role)));

  return {
    hasAccess: autorise,
    role,
    clubId: data?.clubId ?? null,
    isLoading,
    error: (error as Error) ?? null,
  };
}
