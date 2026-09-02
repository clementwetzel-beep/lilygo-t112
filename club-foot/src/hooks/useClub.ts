import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ClubRow, ClubRole, PlayerRow, TeamRow } from '@/integrations/supabase/types';

export const clubKeys = {
  all: ['club'] as const,
  bySlug: (slug: string) => [...clubKeys.all, 'slug', slug] as const,
  mine: (userId: string) => [...clubKeys.all, 'mine', userId] as const,
  teams: (clubId: string) => [...clubKeys.all, 'teams', clubId] as const,
  players: (clubId: string) => [...clubKeys.all, 'players', clubId] as const,
};

/** Fiche club par slug. Prechauffee par le garde de route. */
export function useClub(slug: string | undefined) {
  return useQuery({
    queryKey: clubKeys.bySlug(slug ?? ''),
    queryFn: async (): Promise<ClubRow | null> => {
      const { data, error } = await supabase.from('clubs').select('*').eq('slug', slug!).single();
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!slug,
    staleTime: 1000 * 60 * 5,
  });
}

export interface MonClub {
  club: Pick<ClubRow, 'id' | 'name' | 'slug' | 'logo_url' | 'color' | 'saison'>;
  role: ClubRole;
}

/** Clubs de l'utilisateur : l'ecran d'accueil quand on appartient a plusieurs. */
export function useMyClubs(userId: string | undefined) {
  return useQuery({
    queryKey: clubKeys.mine(userId ?? ''),
    queryFn: async (): Promise<MonClub[]> => {
      const { data, error } = await supabase
        .from('club_members')
        .select('role, clubs:club_id (id, name, slug, logo_url, color, saison)')
        .eq('user_id', userId!)
        .returns<{ role: ClubRole; clubs: MonClub['club'] | null }[]>();

      if (error) throw new Error(error.message);

      return (data ?? [])
        .filter((ligne) => ligne.clubs !== null)
        .map((ligne) => ({ club: ligne.clubs!, role: ligne.role }));
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useTeams(clubId: string | null | undefined) {
  return useQuery({
    queryKey: clubKeys.teams(clubId ?? ''),
    queryFn: async (): Promise<TeamRow[]> => {
      const { data, error } = await supabase
        .from('teams')
        .select('*')
        .eq('club_id', clubId!)
        .eq('archived', false)
        .order('name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!clubId,
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Joueurs "dont je reponds" : moi si je suis licencie, plus mes enfants.
 * Miroir de la fonction SQL my_player_ids() — la RLS filtre deja, on ne
 * recupere donc que ce qui nous concerne.
 */
export function useMesJoueurs(clubId: string | null | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: [...clubKeys.players(clubId ?? ''), 'miens', userId ?? ''],
    queryFn: async () => {
      const [{ data: joueur, error: erreurJoueur }, { data: enfants, error: erreurEnfants }] =
        await Promise.all([
          supabase.from('players').select('*').eq('club_id', clubId!).eq('user_id', userId!),
          supabase
            .from('player_guardians')
            .select('players:player_id (*)')
            .eq('user_id', userId!)
            .returns<{ players: PlayerRow | null }[]>(),
        ]);

      if (erreurJoueur) throw new Error(erreurJoueur.message);
      if (erreurEnfants) throw new Error(erreurEnfants.message);

      const parId = new Map<string, PlayerRow>();
      for (const p of joueur ?? []) parId.set(p.id, p);
      for (const ligne of enfants ?? []) {
        // Un parent peut avoir des enfants dans plusieurs clubs : on ne garde
        // que ceux du club consulte.
        if (ligne.players && ligne.players.club_id === clubId) {
          parId.set(ligne.players.id, ligne.players);
        }
      }

      return Array.from(parId.values());
    },
    enabled: !!clubId && !!userId,
    staleTime: 1000 * 60,
  });
}
