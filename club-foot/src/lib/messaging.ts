import type {
  ClubRole,
  ConversationRow,
  ConversationType,
  MessageRow,
  UnreadCountRow,
} from '@/integrations/supabase/types';
import { isStaff } from './access';
import { cleJour, toDate } from './dates';

export type ConversationLike = Pick<
  ConversationRow,
  'id' | 'type' | 'nom' | 'last_message_at' | 'created_at' | 'is_archived'
>;

export interface ParticipantInfo {
  user_id: string;
  prenom: string | null;
  nom: string | null;
}

const TYPE_LABELS: Record<ConversationType, string> = {
  direct: 'Message direct',
  groupe: 'Groupe',
  equipe: 'Equipe',
  annonce: 'Annonces du club',
};

export function typeConversationLabel(type: ConversationType): string {
  return TYPE_LABELS[type];
}

export function nomParticipant(participant: ParticipantInfo): string {
  const nom = [participant.prenom, participant.nom].filter(Boolean).join(' ').trim();
  return nom || 'Membre du club';
}

/**
 * Titre affiche dans la liste des fils. Une conversation directe n'a pas de
 * nom en base : on montre l'autre personne, jamais soi-meme.
 */
export function titreConversation(
  conversation: ConversationLike,
  participants: readonly ParticipantInfo[],
  currentUserId: string,
): string {
  if (conversation.nom) return conversation.nom;

  if (conversation.type === 'direct') {
    const autres = participants.filter((p) => p.user_id !== currentUserId);
    if (autres.length > 0) return autres.map(nomParticipant).join(', ');
    // Fil avec soi-meme (bloc-notes) : on ne renvoie pas une chaine vide.
    return 'Moi';
  }

  return typeConversationLabel(conversation.type);
}

/**
 * Tri de la liste : le fil qui vient de bouger passe en tete, les fils sans
 * message conservent leur date de creation, les archives descendent.
 */
export function trierConversations<T extends ConversationLike>(conversations: readonly T[]): T[] {
  return [...conversations].sort((a, b) => {
    if (a.is_archived !== b.is_archived) return a.is_archived ? 1 : -1;
    const dateA = toDate(a.last_message_at ?? a.created_at).getTime();
    const dateB = toDate(b.last_message_at ?? b.created_at).getTime();
    return dateB - dateA;
  });
}

export function totalNonLus(compteurs: readonly UnreadCountRow[]): number {
  return compteurs.reduce((total, ligne) => total + Number(ligne.unread ?? 0), 0);
}

export function nonLusParFil(compteurs: readonly UnreadCountRow[]): Map<string, number> {
  return new Map(compteurs.map((c) => [c.conversation_id, Number(c.unread ?? 0)]));
}

/**
 * Miroir de can_post_in_conversation() cote Postgres : dans un fil d'annonces,
 * seule l'encadrement ecrit — les familles lisent.
 */
export function peutEcrire(
  conversation: Pick<ConversationRow, 'type'>,
  role: ClubRole | null | undefined,
): boolean {
  if (conversation.type === 'annonce') return isStaff(role);
  return !!role;
}

/** Regroupe le fil par journee pour intercaler les separateurs de date. */
export function grouperMessagesParJour<T extends Pick<MessageRow, 'created_at'>>(
  messages: readonly T[],
): { jour: string; messages: T[] }[] {
  const groupes = new Map<string, T[]>();

  for (const message of messages) {
    const cle = cleJour(message.created_at);
    const groupe = groupes.get(cle);
    if (groupe) groupe.push(message);
    else groupes.set(cle, [message]);
  }

  return Array.from(groupes.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([jour, list]) => ({ jour, messages: list }));
}
