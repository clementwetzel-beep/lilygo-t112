import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { PollOptionRow, PollRow, PollVoteRow } from '@/integrations/supabase/types';

export const sondageKeys = {
  all: ['sondages'] as const,
  liste: (clubId: string) => [...sondageKeys.all, 'liste', clubId] as const,
  votes: (clubId: string, userId: string) => [...sondageKeys.all, 'votes', clubId, userId] as const,
  resultats: (pollId: string) => [...sondageKeys.all, 'resultats', pollId] as const,
};

export interface SondageAvecOptions extends PollRow {
  poll_options: PollOptionRow[];
}

/** Sondages visibles : can_see_poll() filtre deja brouillons et audiences. */
export function useSondages(clubId: string | null | undefined) {
  return useQuery({
    queryKey: sondageKeys.liste(clubId ?? ''),
    queryFn: async (): Promise<SondageAvecOptions[]> => {
      const { data, error } = await supabase
        .from('polls')
        .select('*, poll_options (*)')
        .eq('club_id', clubId!)
        .order('created_at', { ascending: false })
        .returns<SondageAvecOptions[]>();
      if (error) throw new Error(error.message);
      return (data ?? []).map((sondage) => ({
        ...sondage,
        poll_options: [...(sondage.poll_options ?? [])].sort((a, b) => a.ordre - b.ordre),
      }));
    },
    enabled: !!clubId,
    staleTime: 1000 * 30,
  });
}

/** Mes bulletins : la RLS ne renvoie que les miens. */
export function useMesVotes(clubId: string | null | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: sondageKeys.votes(clubId ?? '', userId ?? ''),
    queryFn: async (): Promise<PollVoteRow[]> => {
      const { data, error } = await supabase.from('poll_votes').select('*').eq('user_id', userId!);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!clubId && !!userId,
    staleTime: 1000 * 30,
  });
}

/** Depouillement serveur : marche aussi quand le sondage est anonyme. */
export function useResultatsSondage(pollId: string | null | undefined) {
  return useQuery({
    queryKey: sondageKeys.resultats(pollId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('poll_results', { p_poll_id: pollId! });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!pollId,
  });
}

/**
 * Voter. Un changement d'avis remplace les bulletins precedents : on supprime
 * puis on reinsere, l'ensemble reste coherent meme en choix multiple.
 */
export function useVoter(clubId: string, userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pollId,
      optionIds,
      playerId = null,
    }: {
      pollId: string;
      optionIds: string[];
      playerId?: string | null;
    }) => {
      const suppression = supabase
        .from('poll_votes')
        .delete()
        .eq('poll_id', pollId)
        .eq('user_id', userId);

      const { error: erreurSuppression } = playerId
        ? await suppression.eq('player_id', playerId)
        : await suppression.is('player_id', null);

      if (erreurSuppression) throw new Error(erreurSuppression.message);

      const { error } = await supabase.from('poll_votes').insert(
        optionIds.map((option_id) => ({
          poll_id: pollId,
          option_id,
          user_id: userId,
          player_id: playerId,
        })),
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: sondageKeys.votes(clubId, userId) });
      queryClient.invalidateQueries({ queryKey: sondageKeys.resultats(variables.pollId) });
    },
  });
}
