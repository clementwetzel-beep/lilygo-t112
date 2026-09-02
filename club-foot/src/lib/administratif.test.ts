import { describe, expect, it } from 'vitest';
import {
  estBloquant,
  formatEuros,
  messageSituation,
  resumeSituation,
  soldeCotisation,
  statutEffectif,
} from './administratif';

const AUJOURDHUI = new Date('2026-09-10T12:00:00Z');

const ligne = (extra: Record<string, unknown> = {}) => ({
  player_id: 'p1',
  prenom: 'Sacha',
  nom: 'Martin',
  team_id: 't1',
  documents_requis: 3,
  documents_valides: 3,
  documents_bloquants: 0,
  cotisation_due_cents: 12000,
  cotisation_payee_cents: 12000,
  en_regle: true,
  ...extra,
});

describe('statutEffectif', () => {
  it('considere un document absent comme manquant', () => {
    expect(statutEffectif(null, AUJOURDHUI)).toBe('manquant');
  });

  it('fait expirer un certificat medical perime', () => {
    expect(
      statutEffectif({ status: 'valide', valid_until: '2026-09-09' }, AUJOURDHUI),
    ).toBe('expire');
  });

  it('garde valide jusqu au bout du dernier jour', () => {
    expect(
      statutEffectif({ status: 'valide', valid_until: '2026-09-10' }, AUJOURDHUI),
    ).toBe('valide');
  });

  it('ne touche pas aux autres statuts, meme avec une date passee', () => {
    expect(
      statutEffectif({ status: 'en_attente', valid_until: '2020-01-01' }, AUJOURDHUI),
    ).toBe('en_attente');
    expect(statutEffectif({ status: 'refuse', valid_until: null }, AUJOURDHUI)).toBe('refuse');
  });
});

describe('estBloquant', () => {
  it('ne bloque ni un document valide ni un document en cours de validation', () => {
    expect(estBloquant('valide')).toBe(false);
    expect(estBloquant('en_attente')).toBe(false);
  });

  it('bloque manquant, refuse et expire', () => {
    expect(estBloquant('manquant')).toBe(true);
    expect(estBloquant('refuse')).toBe(true);
    expect(estBloquant('expire')).toBe(true);
  });
});

describe('soldeCotisation', () => {
  it('calcule le reste a payer', () => {
    expect(soldeCotisation(ligne({ cotisation_payee_cents: 5000 }))).toBe(7000);
  });

  it('ne renvoie jamais un solde negatif', () => {
    expect(soldeCotisation(ligne({ cotisation_payee_cents: 15000 }))).toBe(0);
  });
});

describe('resumeSituation', () => {
  it('agrege le club', () => {
    const resume = resumeSituation([
      ligne(),
      ligne({
        player_id: 'p2',
        documents_bloquants: 2,
        cotisation_payee_cents: 0,
        en_regle: false,
      }),
      ligne({ player_id: 'p3', documents_bloquants: 1, en_regle: false }),
    ]);
    expect(resume).toEqual({
      joueurs: 3,
      enRegle: 1,
      documentsBloquants: 3,
      resteAPayerCents: 12000,
      tauxConformite: 33,
    });
  });

  it('gere un club sans licencie', () => {
    expect(resumeSituation([]).tauxConformite).toBe(0);
  });
});

describe('messageSituation', () => {
  it('felicite un dossier complet', () => {
    expect(messageSituation(ligne())).toBe('Dossier complet');
  });

  it('accorde le singulier', () => {
    expect(messageSituation(ligne({ documents_bloquants: 1, en_regle: false }))).toBe(
      '1 piece a fournir',
    );
  });

  it('cumule pieces et argent', () => {
    const message = messageSituation(
      ligne({ documents_bloquants: 2, cotisation_payee_cents: 4000, en_regle: false }),
    );
    expect(message).toContain('2 pieces a fournir');
    expect(message).toContain('80,00');
  });
});

describe('formatEuros', () => {
  it('formate en euros francais', () => {
    // Intl insere une espace insecable (fine ou non selon la version d'ICU) :
    // on la normalise avant de comparer.
    const normalise = formatEuros(12050).replace(/[\u00a0\u202f]/g, ' ');
    expect(normalise).toBe('120,50 \u20ac');
  });
});
