import { describe, expect, it } from 'vitest';
import {
  canManageAdministratif,
  canManagePlanning,
  isFamille,
  resolveClubAccess,
  roleLabel,
} from './access';

const club = { id: 'club-1', owner_id: 'user-president' };

describe('resolveClubAccess', () => {
  it('accorde le role owner au proprietaire, meme sans adhesion', () => {
    expect(
      resolveClubAccess({ userId: 'user-president', club, memberships: [] }),
    ).toEqual({ hasAccess: true, role: 'owner', clubId: 'club-1' });
  });

  it('accorde l acces a un parent membre', () => {
    expect(
      resolveClubAccess({
        userId: 'user-parent',
        club,
        memberships: [{ club_id: 'club-1', role: 'parent' }],
      }),
    ).toEqual({ hasAccess: true, role: 'parent', clubId: 'club-1' });
  });

  it('refuse quand l adhesion porte sur un AUTRE club', () => {
    expect(
      resolveClubAccess({
        userId: 'user-parent',
        club,
        memberships: [{ club_id: 'club-2', role: 'dirigeant' }],
      }),
    ).toEqual({ hasAccess: false, role: null, clubId: 'club-1' });
  });

  it('refuse un utilisateur non connecte', () => {
    expect(resolveClubAccess({ userId: null, club, memberships: [] }).hasAccess).toBe(false);
  });

  it('refuse quand le club est introuvable (slug inconnu)', () => {
    const verdict = resolveClubAccess({ userId: 'user-parent', club: null, memberships: [] });
    expect(verdict).toEqual({ hasAccess: false, role: null, clubId: null });
  });

  it('refuse un role non habilite mais renvoie quand meme le role reel', () => {
    const verdict = resolveClubAccess({
      userId: 'user-parent',
      club,
      memberships: [{ club_id: 'club-1', role: 'parent' }],
      requiredRoles: ['owner', 'dirigeant'],
    });
    expect(verdict).toEqual({ hasAccess: false, role: 'parent', clubId: 'club-1' });
  });

  it('laisse passer le proprietaire sur une route reservee au bureau', () => {
    const verdict = resolveClubAccess({
      userId: 'user-president',
      club,
      memberships: [],
      requiredRoles: ['owner', 'dirigeant'],
    });
    expect(verdict.hasAccess).toBe(true);
  });
});

describe('droits par role', () => {
  it('le coach gere le planning mais pas l administratif', () => {
    expect(canManagePlanning('coach')).toBe(true);
    expect(canManageAdministratif('coach')).toBe(false);
  });

  it('le dirigeant gere les deux', () => {
    expect(canManagePlanning('dirigeant')).toBe(true);
    expect(canManageAdministratif('dirigeant')).toBe(true);
  });

  it('parent et joueur ne gerent rien', () => {
    for (const role of ['parent', 'joueur'] as const) {
      expect(canManagePlanning(role)).toBe(false);
      expect(canManageAdministratif(role)).toBe(false);
      expect(isFamille(role)).toBe(true);
    }
  });

  it('un role absent ne donne aucun droit', () => {
    expect(canManagePlanning(null)).toBe(false);
    expect(canManageAdministratif(undefined)).toBe(false);
    expect(roleLabel(null)).toBe('Invite');
  });
});
