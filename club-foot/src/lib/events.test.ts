import { describe, expect, it } from 'vitest';
import {
  estPasse,
  grouperParJour,
  reponseAttendue,
  resumePresences,
  separerEvenements,
  titreEvenement,
} from './events';

const NOW = new Date('2026-09-10T12:00:00Z');

const evenement = (id: string, starts_at: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'entrainement' as const,
  titre: 'Entrainement U11',
  starts_at,
  adversaire: null,
  domicile: null,
  lieu: 'Stade municipal',
  status: 'publie' as const,
  reponse_attendue: true,
  ...extra,
});

describe('separerEvenements', () => {
  it('classe les prochains du plus proche au plus lointain', () => {
    const { aVenir } = separerEvenements(
      [
        evenement('c', '2026-09-20T18:00:00Z'),
        evenement('a', '2026-09-11T18:00:00Z'),
        evenement('b', '2026-09-15T18:00:00Z'),
      ],
      NOW,
    );
    expect(aVenir.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('classe les passes du plus recent au plus ancien', () => {
    const { passes } = separerEvenements(
      [evenement('vieux', '2026-08-01T18:00:00Z'), evenement('recent', '2026-09-09T18:00:00Z')],
      NOW,
    );
    expect(passes.map((e) => e.id)).toEqual(['recent', 'vieux']);
  });

  it('compte un evenement en cours du jour comme passe des le coup d envoi', () => {
    expect(estPasse(evenement('x', '2026-09-10T11:59:00Z'), NOW)).toBe(true);
    expect(estPasse(evenement('x', '2026-09-10T12:01:00Z'), NOW)).toBe(false);
  });
});

describe('grouperParJour', () => {
  it('regroupe les evenements d une meme journee', () => {
    const groupes = grouperParJour([
      evenement('a', '2026-09-12T10:00:00Z'),
      evenement('b', '2026-09-12T15:00:00Z'),
      evenement('c', '2026-09-13T10:00:00Z'),
    ]);
    expect(groupes.map((g) => [g.jour, g.events.length])).toEqual([
      ['2026-09-12', 2],
      ['2026-09-13', 1],
    ]);
  });
});

describe('titreEvenement', () => {
  it('annonce une reception', () => {
    const titre = titreEvenement(
      evenement('m', '2026-09-14T15:00:00Z', {
        type: 'match',
        adversaire: 'AS Cheminots',
        domicile: true,
      }),
    );
    expect(titre).toBe('Reception de AS Cheminots');
  });

  it('annonce un deplacement', () => {
    const titre = titreEvenement(
      evenement('m', '2026-09-14T15:00:00Z', {
        type: 'match',
        adversaire: 'AS Cheminots',
        domicile: false,
      }),
    );
    expect(titre).toBe('Deplacement a AS Cheminots');
  });

  it('garde le titre libre pour un entrainement', () => {
    expect(titreEvenement(evenement('e', '2026-09-14T15:00:00Z'))).toBe('Entrainement U11');
  });
});

describe('resumePresences', () => {
  it('compte chaque statut et le taux de reponse', () => {
    const resume = resumePresences([
      { status: 'present' },
      { status: 'present' },
      { status: 'absent' },
      { status: 'incertain' },
      { status: 'en_attente' },
    ]);
    expect(resume).toEqual({
      present: 2,
      absent: 1,
      incertain: 1,
      en_attente: 1,
      total: 5,
      tauxReponse: 80,
    });
  });

  it('ne divise pas par zero sans convoque', () => {
    expect(resumePresences([]).tauxReponse).toBe(0);
  });
});

describe('reponseAttendue', () => {
  it('reclame une reponse pour un match publie a venir sans reponse', () => {
    expect(reponseAttendue(evenement('m', '2026-09-14T15:00:00Z'), null, NOW)).toBe(true);
  });

  it('ne reclame rien si le joueur a deja repondu', () => {
    expect(
      reponseAttendue(evenement('m', '2026-09-14T15:00:00Z'), { status: 'absent' }, NOW),
    ).toBe(false);
  });

  it('ne reclame rien sur un brouillon ni sur un evenement passe', () => {
    expect(
      reponseAttendue(evenement('m', '2026-09-14T15:00:00Z', { status: 'brouillon' }), null, NOW),
    ).toBe(false);
    expect(reponseAttendue(evenement('m', '2026-09-01T15:00:00Z'), null, NOW)).toBe(false);
  });

  it('ne reclame rien quand l evenement ne demande pas de reponse', () => {
    expect(
      reponseAttendue(
        evenement('r', '2026-09-14T15:00:00Z', { reponse_attendue: false }),
        null,
        NOW,
      ),
    ).toBe(false);
  });
});
