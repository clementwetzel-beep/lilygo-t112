import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  ConversationRow,
  ConversationType,
  MessageRow,
  UnreadCountRow,
} from '@/integrations/supabase/types';

export const messagerieKeys = {
  all: ['messagerie'] as const,
  conversations: (clubId: string) => [...messagerieKeys.all, 'conversations', clubId] as const,
  messages: (conversationId: string) => [...messagerieKeys.all, 'messages', conversationId] as const,
  participants: (conversationId: string) =>
    [...messagerieKeys.all, 'participants', conversationId] as const,
  nonLus: (clubId: string) => [...messagerieKeys.all, 'non-lus', clubId] as const,
};

/** Fils du club auxquels je participe (la RLS ne renvoie que ceux-la). */
export function useConversations(clubId: string | null | undefined) {
  return useQuery({
    queryKey: messagerieKeys.conversations(clubId ?? ''),
    queryFn: async (): Promise<ConversationRow[]> => {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('club_id', clubId!)
        .order('last_message_at', { ascending: false, nullsFirst: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!clubId,
    staleTime: 1000 * 15,
  });
}

export interface MessageAvecAuteur extends MessageRow {
  auteur: { user_id: string; prenom: string | null; nom: string | null } | null;
}

export function useMessages(conversationId: string | null | undefined) {
  return useQuery({
    queryKey: messagerieKeys.messages(conversationId ?? ''),
    queryFn: async (): Promise<MessageAvecAuteur[]> => {
      const { data, error } = await supabase
        .from('messages')
        .select('*, auteur:profiles!inner (user_id, prenom, nom)')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: true })
        .returns<MessageAvecAuteur[]>();
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!conversationId,
  });
}

export function useParticipants(conversationId: string | null | undefined) {
  return useQuery({
    queryKey: messagerieKeys.participants(conversationId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversation_participants')
        .select('user_id, last_read_at, profiles:user_id (user_id, prenom, nom)')
        .eq('conversation_id', conversationId!)
        .returns<
          {
            user_id: string;
            last_read_at: string | null;
            profiles: { user_id: string; prenom: string | null; nom: string | null } | null;
          }[]
        >();
      if (error) throw new Error(error.message);
      return (data ?? []).map((ligne) => ({
        user_id: ligne.user_id,
        prenom: ligne.profiles?.prenom ?? null,
        nom: ligne.profiles?.nom ?? null,
      }));
    },
    enabled: !!conversationId,
    staleTime: 1000 * 60,
  });
}

export function useNonLus(clubId: string | null | undefined) {
  return useQuery({
    queryKey: messagerieKeys.nonLus(clubId ?? ''),
    queryFn: async (): Promise<UnreadCountRow[]> => {
      const { data, error } = await supabase.rpc('unread_counts', { p_club_id: clubId! });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!clubId,
    staleTime: 1000 * 15,
  });
}

export function useEnvoyerMessage(clubId: string, userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      contenu,
    }: {
      conversationId: string;
      contenu: string;
    }) => {
      const { error } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: userId,
        contenu: contenu.trim(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: messagerieKeys.messages(variables.conversationId) });
      queryClient.invalidateQueries({ queryKey: messagerieKeys.conversations(clubId) });
      queryClient.invalidateQueries({ queryKey: messagerieKeys.nonLus(clubId) });
    },
  });
}

/**
 * Creation d'un fil : passe par la RPC create_conversation, qui insere le fil
 * ET ses participants dans la meme transaction. Une policy INSERT ne peut pas
 * verifier des participants qui n'existent pas encore.
 */
export function useCreerConversation(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      type,
      nom,
      participantIds,
      teamId = null,
    }: {
      type: ConversationType;
      nom: string | null;
      participantIds: string[];
      teamId?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('create_conversation', {
        p_club_id: clubId,
        p_type: type,
        p_nom: nom,
        p_participant_ids: participantIds,
        p_team_id: teamId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagerieKeys.conversations(clubId) });
    },
  });
}

export function useMarquerCommeLu(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase.rpc('mark_conversation_read', {
        p_conversation_id: conversationId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagerieKeys.nonLus(clubId) });
    },
  });
}

/**
 * Temps reel : un nouveau message arrive sans que personne ne rafraichisse.
 * On invalide plutot que d'inserer a la main — la source de verite reste la
 * base, et la RLS reste seule juge de ce qu'on a le droit de lire.
 */
export function useMessagesRealtime(clubId: string | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!clubId) return;

    const canal = supabase
      .channel(`messages-club-${clubId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const conversationId = (payload.new as MessageRow | undefined)?.conversation_id;
          if (conversationId) {
            queryClient.invalidateQueries({ queryKey: messagerieKeys.messages(conversationId) });
          }
          queryClient.invalidateQueries({ queryKey: messagerieKeys.conversations(clubId) });
          queryClient.invalidateQueries({ queryKey: messagerieKeys.nonLus(clubId) });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(canal);
    };
  }, [clubId, queryClient]);
}
