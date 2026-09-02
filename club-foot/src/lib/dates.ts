import { format, formatDistanceToNowStrict, isSameDay, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

export function toDate(value: string | Date): Date {
  return typeof value === 'string' ? parseISO(value) : value;
}

/** "sam. 14 sept." */
export function formatJour(value: string | Date): string {
  return format(toDate(value), 'EEE d MMM', { locale: fr });
}

/** "samedi 14 septembre 2026" */
export function formatJourLong(value: string | Date): string {
  return format(toDate(value), 'EEEE d MMMM yyyy', { locale: fr });
}

/** "15h30" */
export function formatHeure(value: string | Date): string {
  return format(toDate(value), "HH'h'mm", { locale: fr });
}

/** "sam. 14 sept. — 15h30" */
export function formatDateHeure(value: string | Date): string {
  return `${formatJour(value)} — ${formatHeure(value)}`;
}

/** "il y a 3 min" */
export function formatRelatif(value: string | Date): string {
  return formatDistanceToNowStrict(toDate(value), { locale: fr, addSuffix: true });
}

export function memeJour(a: string | Date, b: string | Date): boolean {
  return isSameDay(toDate(a), toDate(b));
}

/** Cle de regroupement stable pour les listes ("2026-09-14"). */
export function cleJour(value: string | Date): string {
  return format(toDate(value), 'yyyy-MM-dd');
}
