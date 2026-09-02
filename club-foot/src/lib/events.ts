import type { AttendanceStatus, EventRow, EventType } from '@/integrations/supabase/types';
import { cleJour, toDate } from './dates';

export type EventLike = Pick<
  EventRow,
  'id' | 'type' | 'titre' | 'starts_at' | 'adversaire' | 'domicile' | 'lieu' | 'status'
>;

const TYPE_LABELS: Record<EventType, string> = {
  entrainement: 'Entrainement',
  match: 'Match',
  tournoi: 'Tournoi',
  reunion: 'Reunion',
  autre: 'Evenement',
};

export function typeLabel(type: EventType): string {
  return TYPE_LABELS[type];
}

/**
 * Intitule affiche dans les listes : pour un match on veut voir l'adversaire
 * et savoir si on se deplace, c'est l'information que les familles cherchent.
 */
export function titreEvenement(event: EventLike): string {
  if (event.type === 'match' && event.adversaire) {
    const lieu = event.domicile === false ? 'Deplacement a' : 'Reception de';
    return `${lieu} ${event.adversaire}`;
  }
  return event.titre;
}

export function estPasse(event: Pick<EventRow, 'starts_at'>, now: Date = new Date()): boolean {
  return toDate(event.starts_at).getTime() < now.getTime();
}

/**
 * Separe l'agenda en "a venir" (chronologique, le plus proche d'abord) et
 * "passes" (anti-chronologique, le plus recent d'abord).
 */
export function separerEvenements<T extends Pick<EventRow, 'starts_at'>>(
  events: readonly T[],
  now: Date = new Date(),
): { aVenir: T[]; passes: T[] } {
  const aVenir: T[] = [];
  const passes: T[] = [];

  for (const event of events) {
    (estPasse(event, now) ? passes : aVenir).push(event);
  }

  aVenir.sort((a, b) => toDate(a.starts_at).getTime() - toDate(b.starts_at).getTime());
  passes.sort((a, b) => toDate(b.starts_at).getTime() - toDate(a.starts_at).getTime());

  return { aVenir, passes };
}

/** Regroupe par journee pour afficher un planning avec des en-tetes de date. */
export function grouperParJour<T extends Pick<EventRow, 'starts_at'>>(
  events: readonly T[],
): { jour: string; events: T[] }[] {
  const groupes = new Map<string, T[]>();

  for (const event of events) {
    const cle = cleJour(event.starts_at);
    const groupe = groupes.get(cle);
    if (groupe) groupe.push(event);
    else groupes.set(cle, [event]);
  }

  return Array.from(groupes.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([jour, list]) => ({ jour, events: list }));
}

export interface ResumePresence {
  present: number;
  absent: number;
  incertain: number;
  en_attente: number;
  total: number;
  /** Part de convoques ayant repondu, en pourcentage entier (0 si personne). */
  tauxReponse: number;
}

export function resumePresences(
  responses: readonly { status: AttendanceStatus }[],
): ResumePresence {
  const resume: ResumePresence = {
    present: 0,
    absent: 0,
    incertain: 0,
    en_attente: 0,
    total: responses.length,
    tauxReponse: 0,
  };

  for (const reponse of responses) {
    resume[reponse.status] += 1;
  }

  if (resume.total > 0) {
    const repondus = resume.total - resume.en_attente;
    resume.tauxReponse = Math.round((repondus / resume.total) * 100);
  }

  return resume;
}

/** Une convocation reclame une reponse tant qu'elle est en attente et a venir. */
export function reponseAttendue(
  event: Pick<EventRow, 'starts_at' | 'status' | 'reponse_attendue'>,
  reponse: { status: AttendanceStatus } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!event.reponse_attendue) return false;
  if (event.status !== 'publie') return false;
  if (estPasse(event, now)) return false;
  return (reponse?.status ?? 'en_attente') === 'en_attente';
}

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  en_attente: 'Sans reponse',
  present: 'Present',
  absent: 'Absent',
  incertain: 'Peut-etre',
};

export function presenceLabel(status: AttendanceStatus): string {
  return STATUS_LABELS[status];
}
