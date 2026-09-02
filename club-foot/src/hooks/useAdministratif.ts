import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  DocumentTypeRow,
  PlayerDocumentRow,
  SituationAdministrativeRow,
} from '@/integrations/supabase/types';

export const administratifKeys = {
  all: ['administratif'] as const,
  situation: (clubId: string) => [...administratifKeys.all, 'situation', clubId] as const,
  typesDocuments: (clubId: string) => [...administratifKeys.all, 'types', clubId] as const,
  documents: (clubId: string) => [...administratifKeys.all, 'documents', clubId] as const,
};

/**
 * Situation administrative agregee (documents + cotisation), calculee cote
 * Postgres par situation_administrative(). La meme fonction sert aux familles
 * (leurs joueurs) et au bureau (tout le club) : c'est la RLS qui tranche.
 */
export function useSituationAdministrative(clubId: string | null | undefined) {
  return useQuery({
    queryKey: administratifKeys.situation(clubId ?? ''),
    queryFn: async (): Promise<SituationAdministrativeRow[]> => {
      const { data, error } = await supabase.rpc('situation_administrative', {
        p_club_id: clubId!,
      });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!clubId,
    staleTime: 1000 * 60,
  });
}

export function useTypesDocuments(clubId: string | null | undefined) {
  return useQuery({
    queryKey: administratifKeys.typesDocuments(clubId ?? ''),
    queryFn: async (): Promise<DocumentTypeRow[]> => {
      const { data, error } = await supabase
        .from('document_types')
        .select('*')
        .eq('club_id', clubId!)
        .eq('actif', true)
        .order('ordre');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!clubId,
    staleTime: 1000 * 60 * 5,
  });
}

/** Pieces deja deposees (la RLS restreint aux joueurs dont on repond). */
export function useDocumentsJoueurs(clubId: string | null | undefined) {
  return useQuery({
    queryKey: administratifKeys.documents(clubId ?? ''),
    queryFn: async (): Promise<PlayerDocumentRow[]> => {
      const { data, error } = await supabase
        .from('player_documents')
        .select('*')
        .eq('club_id', clubId!);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!clubId,
    staleTime: 1000 * 60,
  });
}

/**
 * Depot d'une piece par une famille. Le statut retombe TOUJOURS en
 * 'en_attente' : personne ne valide son propre dossier (la policy
 * player_documents_update_own l'impose aussi cote base).
 */
export function useDeposerDocument(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      playerId,
      documentTypeId,
      fichierUrl,
      validUntil,
    }: {
      playerId: string;
      documentTypeId: string;
      fichierUrl: string;
      validUntil?: string | null;
    }) => {
      const { error } = await supabase.from('player_documents').upsert(
        {
          club_id: clubId,
          player_id: playerId,
          document_type_id: documentTypeId,
          fichier_url: fichierUrl,
          valid_until: validUntil ?? null,
          status: 'en_attente',
          submitted_at: new Date().toISOString(),
        },
        { onConflict: 'player_id,document_type_id' },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: administratifKeys.all });
    },
  });
}

/** Validation/refus par le bureau. */
export function useValiderDocument(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      documentId,
      valide,
      motifRefus,
    }: {
      documentId: string;
      valide: boolean;
      motifRefus?: string;
    }) => {
      const { error } = await supabase
        .from('player_documents')
        .update({
          status: valide ? 'valide' : 'refuse',
          motif_refus: valide ? null : (motifRefus ?? null),
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', documentId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: administratifKeys.all });
      queryClient.invalidateQueries({ queryKey: administratifKeys.situation(clubId) });
    },
  });
}
