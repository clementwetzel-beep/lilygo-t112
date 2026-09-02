import type {
  DocumentStatus,
  PlayerDocumentRow,
  SituationAdministrativeRow,
} from '@/integrations/supabase/types';

/**
 * Miroir EXACT de la fonction SQL document_effective_status() : un document
 * valide dont la date de validite est depassee (certificat medical, surtout)
 * bascule en 'expire' a la lecture. Aucun cron a maintenir des deux cotes.
 */
export function statutEffectif(
  document: Pick<PlayerDocumentRow, 'status' | 'valid_until'> | null | undefined,
  aujourdhui: Date = new Date(),
): DocumentStatus {
  if (!document) return 'manquant';
  if (document.status !== 'valide' || !document.valid_until) return document.status;

  const limite = new Date(`${document.valid_until}T23:59:59`);
  return limite.getTime() < aujourdhui.getTime() ? 'expire' : 'valide';
}

const STATUS_LABELS: Record<DocumentStatus, string> = {
  manquant: 'A fournir',
  en_attente: 'En cours de validation',
  valide: 'Valide',
  refuse: 'Refuse',
  expire: 'Expire',
};

export function statutLabel(status: DocumentStatus): string {
  return STATUS_LABELS[status];
}

/** true = la piece bloque la participation (a fournir ou a refaire). */
export function estBloquant(status: DocumentStatus): boolean {
  return status !== 'valide' && status !== 'en_attente';
}

export function formatEuros(cents: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(
    cents / 100,
  );
}

/** Reste a payer, jamais negatif (un trop-percu n'est pas une dette negative). */
export function soldeCotisation(
  ligne: Pick<SituationAdministrativeRow, 'cotisation_due_cents' | 'cotisation_payee_cents'>,
): number {
  return Math.max(0, ligne.cotisation_due_cents - ligne.cotisation_payee_cents);
}

export interface ResumeClub {
  joueurs: number;
  enRegle: number;
  documentsBloquants: number;
  resteAPayerCents: number;
  /** Part de licencies en regle, en pourcentage entier. */
  tauxConformite: number;
}

/** Vue bureau : ou en est le club, en une ligne. */
export function resumeSituation(lignes: readonly SituationAdministrativeRow[]): ResumeClub {
  const resume: ResumeClub = {
    joueurs: lignes.length,
    enRegle: 0,
    documentsBloquants: 0,
    resteAPayerCents: 0,
    tauxConformite: 0,
  };

  for (const ligne of lignes) {
    if (ligne.en_regle) resume.enRegle += 1;
    resume.documentsBloquants += ligne.documents_bloquants;
    resume.resteAPayerCents += soldeCotisation(ligne);
  }

  if (resume.joueurs > 0) {
    resume.tauxConformite = Math.round((resume.enRegle / resume.joueurs) * 100);
  }

  return resume;
}

/** Ce qui manque, formule pour une famille ("Il manque 2 pieces, 120,00 € a regler"). */
export function messageSituation(ligne: SituationAdministrativeRow): string {
  const manques: string[] = [];

  if (ligne.documents_bloquants > 0) {
    manques.push(
      ligne.documents_bloquants === 1
        ? '1 piece a fournir'
        : `${ligne.documents_bloquants} pieces a fournir`,
    );
  }

  const solde = soldeCotisation(ligne);
  if (solde > 0) manques.push(`${formatEuros(solde)} a regler`);

  return manques.length === 0 ? 'Dossier complet' : manques.join(' · ');
}
