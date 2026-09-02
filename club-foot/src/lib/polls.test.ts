import { describe, expect, it } from 'vitest';
import { aVote, depouiller, mesChoix, selectionValide, sondageOuvert } from './polls';

const NOW = new Date('2026-09-10T12:00:00Z');
const poll = (extra: Record<string, unknown> = {}) => ({
  id: 'poll-1',
  status: 'ouvert' as const,
  closes_at: null,
  choix_multiple: false,
  ...extra,
});

describe('sondageOuvert', () => {
  it('accepte un sondage ouvert sans echeance', () => {
    expect(sondageOuvert(poll(), NOW)).toBe(true);
  });

  it('refuse un brouillon et un sondage clos', () => {
    expect(sondageOuvert(poll({ status: 'brouillon' }), NOW)).toBe(false);
    expect(sondageOuvert(poll({ status: 'clos' }), NOW)).toBe(false);
  });

  it('refuse un sondage dont la date de cloture est passee', () => {
    expect(sondageOuvert(poll({ closes_at: '2026-09-09T12:00:00Z' }), NOW)).toBe(false);
    expect(sondageOuvert(poll({ closes_at: '2026-09-11T12:00:00Z' }), NOW)).toBe(true);
  });
});

describe('depouiller', () => {
  const options = [
    { id: 'o1', label: 'Je viens', ordre: 1 },
    { id: 'o2', label: 'Je ne viens pas', ordre: 2 },
    { id: 'o3', label: 'Je peux conduire', ordre: 3 },
  ];

  it('compte les voix et calcule les pourcentages', () => {
    const { resultats, total } = depouiller(options, [
      { option_id: 'o1' },
      { option_id: 'o1' },
      { option_id: 'o2' },
      { option_id: 'o1' },
    ]);
    expect(total).toBe(4);
    expect(resultats).toEqual([
      { optionId: 'o1', label: 'Je viens', votes: 3, pourcentage: 75 },
      { optionId: 'o2', label: 'Je ne viens pas', votes: 1, pourcentage: 25 },
      { optionId: 'o3', label: 'Je peux conduire', votes: 0, pourcentage: 0 },
    ]);
  });

  it('renvoie 0 % partout quand personne n a vote', () => {
    const { resultats, total } = depouiller(options, []);
    expect(total).toBe(0);
    expect(resultats.every((r) => r.pourcentage === 0)).toBe(true);
  });

  it('respecte l ordre des options', () => {
    const { resultats } = depouiller([...options].reverse(), []);
    expect(resultats.map((r) => r.optionId)).toEqual(['o1', 'o2', 'o3']);
  });
});

describe('mesChoix / aVote', () => {
  const votes = [
    { option_id: 'o1', user_id: 'moi', player_id: 'enfant-1' },
    { option_id: 'o2', user_id: 'moi', player_id: 'enfant-2' },
    { option_id: 'o1', user_id: 'autre', player_id: null },
  ];

  it('isole les voix d un parent enfant par enfant', () => {
    expect(mesChoix(votes, 'moi', 'enfant-1')).toEqual(['o1']);
    expect(mesChoix(votes, 'moi', 'enfant-2')).toEqual(['o2']);
    expect(aVote(votes, 'moi', 'enfant-3')).toBe(false);
  });

  it('ne melange pas les votants', () => {
    expect(mesChoix(votes, 'autre')).toEqual(['o1']);
  });
});

describe('selectionValide', () => {
  it('refuse une selection vide', () => {
    expect(selectionValide(poll(), [])).toBe(false);
  });

  it('refuse deux options sur un choix unique', () => {
    expect(selectionValide(poll(), ['o1', 'o2'])).toBe(false);
    expect(selectionValide(poll({ choix_multiple: true }), ['o1', 'o2'])).toBe(true);
  });
});
