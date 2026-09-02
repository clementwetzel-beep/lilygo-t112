import type { ClubRole } from '@/integrations/supabase/types';

/**
 * Regles d'acces cote client.
 *
 * ATTENTION : ces fonctions servent a AFFICHER la bonne interface, pas a
 * proteger la donnee. L'autorisation reelle vient des policies RLS (voir
 * supabase/migrations) — is_club_staff() / is_club_bureau() en sont le miroir
 * exact cote Postgres. Toute regle ajoutee ici doit l'etre aussi la-bas.
 */

/** Encadrement : droit d'ecriture sur le planning et les convocations. */
export const STAFF_ROLES: readonly ClubRole[] = ['owner', 'dirigeant', 'coach'] as const;

/** Bureau : droit sur l'administratif (licences, documents, cotisations). */
export const BUREAU_ROLES: readonly ClubRole[] = ['owner', 'dirigeant'] as const;

/** Cote "famille" : consulte, repond, depose des pieces. */
export const FAMILLE_ROLES: readonly ClubRole[] = ['joueur', 'parent'] as const;

export interface ClubForAccess {
  id: string;
  owner_id: string;
}

export interface MembershipForAccess {
  club_id: string;
  role: ClubRole;
}

export interface ClubAccess {
  hasAccess: boolean;
  role: ClubRole | null;
  clubId: string | null;
}

const REFUSE: ClubAccess = { hasAccess: false, role: null, clubId: null };

/**
 * Verdict d'acces a un club.
 *
 * Le club et les adhesions sont lus EN PARALLELE par l'appelant (une requete
 * par slug, une requete "mes adhesions"), puis rapproches ici : la policy
 * club_members_select_self autorise `user_id = auth.uid()` et le couple
 * (club_id, user_id) est UNIQUE, donc filtrer en memoire equivaut a un
 * .eq('club_id', ...) — sans le second aller-retour reseau sur le chemin
 * critique du garde de route.
 */
export function resolveClubAccess(params: {
  userId: string | null | undefined;
  club: ClubForAccess | null | undefined;
  memberships: MembershipForAccess[] | null | undefined;
  requiredRoles?: readonly ClubRole[];
}): ClubAccess {
  const { userId, club, memberships, requiredRoles } = params;

  if (!userId || !club) return REFUSE;

  // Le proprietaire n'a pas besoin d'adhesion : il EST le club.
  const membership = memberships?.find((m) => m.club_id === club.id);
  const role: ClubRole | null =
    club.owner_id === userId ? 'owner' : (membership?.role ?? null);

  if (!role) return { ...REFUSE, clubId: club.id };

  if (requiredRoles && !requiredRoles.includes(role)) {
    return { hasAccess: false, role, clubId: club.id };
  }

  return { hasAccess: true, role, clubId: club.id };
}

export function isStaff(role: ClubRole | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role);
}

export function isBureau(role: ClubRole | null | undefined): boolean {
  return !!role && BUREAU_ROLES.includes(role);
}

export function isFamille(role: ClubRole | null | undefined): boolean {
  return !!role && FAMILLE_ROLES.includes(role);
}

/** Creer / publier un entrainement ou un match, convoquer une equipe. */
export const canManagePlanning = isStaff;

/** Valider une licence, encaisser une cotisation, inviter un membre. */
export const canManageAdministratif = isBureau;

/** Ouvrir un sondage. */
export const canCreatePoll = isStaff;

/** Ecrire dans un fil d'annonces (descendant). */
export const canPostAnnonce = isStaff;

const ROLE_LABELS: Record<ClubRole, string> = {
  owner: 'President',
  dirigeant: 'Dirigeant',
  coach: 'Educateur',
  joueur: 'Joueur',
  parent: 'Parent',
};

export function roleLabel(role: ClubRole | null | undefined): string {
  return role ? ROLE_LABELS[role] : 'Invite';
}
