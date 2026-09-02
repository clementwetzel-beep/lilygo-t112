import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  AttendanceStatus,
  EventResponseRow,
  EventRow,
} from '@/integrations/supabase/types';

export const planningKeys = {
  all: ['planning'] as const,
  events: (clubId: string) => [...planningKeys.all, 'events', clubId] as const,
  responses: (clubId: string, userId: string) =>
    [...planningKeys.all, 'responses', clubId, userId] as const,
  eventResponses: (eventId: string) => [...planningKeys.all, 'event', eventId] as const,
};

/**
 * Agenda du club. La RLS s'occupe du filtrage : une famille ne voit que les
 * evenements publies, l'encadrement voit aussi ses brouillons.
 */
export function useEvents(clubId: string | null | undefined) {
  return useQuery({
    queryKey: planningKeys.events(clubId ?? ''),
    queryFn: async (): Promise<EventRow[]> => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('club_id', clubId!)
        .order('starts_at', { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!clubId,
    staleTime: 1000 * 30,
  });
}

/** Mes convocations (les miennes et celles de mes enfants), indexees par evenement. */
export function useMesReponses(clubId: string | null | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: planningKeys.responses(clubId ?? '', userId ?? ''),
    queryFn: async (): Promise<EventResponseRow[]> => {
      const { data, error } = await supabase.from('event_responses').select('*');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!clubId && !!userId,
    staleTime: 1000 * 30,
  });
}

/** Feuille de presence d'un evenement (vue coach). */
export function useEventResponses(eventId: string | null | undefined) {
  return useQuery({
    queryKey: planningKeys.eventResponses(eventId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_responses')
        .select('*, players:player_id (id, prenom, nom, numero_maillot, poste)')
        .eq('event_id', eventId!)
        .returns<
          (EventResponseRow & {
            players: {
              id: string;
              prenom: string;
              nom: string;
              numero_maillot: number | null;
              poste: string | null;
            } | null;
          })[]
        >();
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!eventId,
  });
}

/** Repondre a une convocation (present / absent / peut-etre). */
export function useRepondreConvocation(clubId: string, userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      responseId,
      status,
      commentaire,
    }: {
      responseId: string;
      status: AttendanceStatus;
      commentaire?: string | null;
    }) => {
      const { error } = await supabase
        .from('event_responses')
        .update({ status, commentaire: commentaire ?? null })
        .eq('id', responseId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: planningKeys.responses(clubId, userId) });
      queryClient.invalidateQueries({ queryKey: planningKeys.all });
    },
  });
}

/** Creation d'un entrainement ou d'un match par l'encadrement. */
export function useCreerEvenement(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (event: Partial<EventRow> & { titre: string; starts_at: string }) => {
      const { data, error } = await supabase
        .from('events')
        .insert({ ...event, club_id: clubId })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: planningKeys.events(clubId) });
    },
  });
}

/** Convoque toute l'equipe rattachee a l'evenement (RPC cote serveur). */
export function useConvoquerEquipe(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (eventId: string) => {
      const { data, error } = await supabase.rpc('convoquer_equipe', { p_event_id: eventId });
      if (error) throw new Error(error.message);
      return data ?? 0;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: planningKeys.all });
      queryClient.invalidateQueries({ queryKey: planningKeys.events(clubId) });
    },
  });
}
