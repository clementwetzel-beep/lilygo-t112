import type { PollOptionRow, PollRow, PollVoteRow } from '@/integrations/supabase/types';
import { toDate } from './dates';

export type PollLike = Pick<PollRow, 'id' | 'status' | 'closes_at' | 'choix_multiple'>;

/** Un sondage n'accepte des voix que s'il est ouvert ET pas encore echu. */
export function sondageOuvert(poll: PollLike, now: Date = new Date()): boolean {
  if (poll.status !== 'ouvert') return false;
  if (!poll.closes_at) return true;
  return toDate(poll.closes_at).getTime() > now.getTime();
}

export interface ResultatOption {
  optionId: string;
  label: string;
  votes: number;
  /** Pourcentage entier, arrondi ; 0 quand personne n'a vote. */
  pourcentage: number;
}

/**
 * Depouillement. Les totaux viennent de la fonction poll_results() cote
 * Postgres pour les sondages anonymes ; ce calcul sert a l'affichage local
 * (et permet de tester la logique sans base).
 */
export function depouiller(
  options: readonly Pick<PollOptionRow, 'id' | 'label' | 'ordre'>[],
  votes: readonly Pick<PollVoteRow, 'option_id'>[],
): { resultats: ResultatOption[]; total: number } {
  const compte = new Map<string, number>();
  for (const vote of votes) {
    compte.set(vote.option_id, (compte.get(vote.option_id) ?? 0) + 1);
  }

  const total = votes.length;

  const resultats = [...options]
    .sort((a, b) => a.ordre - b.ordre || a.label.localeCompare(b.label))
    .map((option) => {
      const nb = compte.get(option.id) ?? 0;
      return {
        optionId: option.id,
        label: option.label,
        votes: nb,
        pourcentage: total === 0 ? 0 : Math.round((nb / total) * 100),
      };
    });

  return { resultats, total };
}

/** Options deja cochees par l'utilisateur (pour un joueur donne, le cas echeant). */
export function mesChoix(
  votes: readonly Pick<PollVoteRow, 'option_id' | 'user_id' | 'player_id'>[],
  userId: string,
  playerId: string | null = null,
): string[] {
  return votes
    .filter((v) => v.user_id === userId && (v.player_id ?? null) === playerId)
    .map((v) => v.option_id);
}

export function aVote(
  votes: readonly Pick<PollVoteRow, 'option_id' | 'user_id' | 'player_id'>[],
  userId: string,
  playerId: string | null = null,
): boolean {
  return mesChoix(votes, userId, playerId).length > 0;
}

/** Un sondage a choix unique refuse plus d'une option. */
export function selectionValide(poll: PollLike, selection: readonly string[]): boolean {
  if (selection.length === 0) return false;
  return poll.choix_multiple || selection.length === 1;
}
