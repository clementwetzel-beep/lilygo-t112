import { describe, expect, it } from 'vitest';
import {
  grouperMessagesParJour,
  nonLusParFil,
  peutEcrire,
  titreConversation,
  totalNonLus,
  trierConversations,
} from './messaging';

const conversation = (extra: Record<string, unknown> = {}) => ({
  id: 'c1',
  type: 'direct' as const,
  nom: null,
  last_message_at: null,
  created_at: '2026-09-01T10:00:00Z',
  is_archived: false,
  ...extra,
});

describe('titreConversation', () => {
  const participants = [
    { user_id: 'moi', prenom: 'Clement', nom: 'W' },
    { user_id: 'coach', prenom: 'Karim', nom: 'Benali' },
  ];

  it('affiche l interlocuteur dans un fil direct, pas soi-meme', () => {
    expect(titreConversation(conversation(), participants, 'moi')).toBe('Karim Benali');
  });

  it('garde le nom du groupe quand il existe', () => {
    expect(
      titreConversation(conversation({ type: 'groupe', nom: 'Covoiturage U11' }), participants, 'moi'),
    ).toBe('Covoiturage U11');
  });

  it('nomme les fils descendants par leur nature', () => {
    expect(titreConversation(conversation({ type: 'annonce' }), participants, 'moi')).toBe(
      'Annonces du club',
    );
  });

  it('ne renvoie pas un titre vide pour un fil avec soi-meme', () => {
    expect(titreConversation(conversation(), [participants[0]], 'moi')).toBe('Moi');
  });

  it('supporte un participant sans identite renseignee', () => {
    expect(
      titreConversation(conversation(), [{ user_id: 'x', prenom: null, nom: null }], 'moi'),
    ).toBe('Membre du club');
  });
});

describe('trierConversations', () => {
  it('remonte le dernier fil actif et repousse les archives', () => {
    const tries = trierConversations([
      conversation({ id: 'ancien', last_message_at: '2026-09-02T10:00:00Z' }),
      conversation({ id: 'archive', last_message_at: '2026-09-09T10:00:00Z', is_archived: true }),
      conversation({ id: 'recent', last_message_at: '2026-09-08T10:00:00Z' }),
      conversation({ id: 'jamais-ecrit', created_at: '2026-09-05T10:00:00Z' }),
    ]);
    expect(tries.map((c) => c.id)).toEqual(['recent', 'jamais-ecrit', 'ancien', 'archive']);
  });
});

describe('compteurs de non-lus', () => {
  const compteurs = [
    { conversation_id: 'c1', unread: 3 },
    { conversation_id: 'c2', unread: 0 },
    { conversation_id: 'c3', unread: 12 },
  ];

  it('additionne la pastille globale', () => {
    expect(totalNonLus(compteurs)).toBe(15);
    expect(totalNonLus([])).toBe(0);
  });

  it('indexe par fil', () => {
    expect(nonLusParFil(compteurs).get('c3')).toBe(12);
  });
});

describe('peutEcrire', () => {
  it('reserve les annonces a l encadrement', () => {
    expect(peutEcrire({ type: 'annonce' }, 'coach')).toBe(true);
    expect(peutEcrire({ type: 'annonce' }, 'parent')).toBe(false);
  });

  it('laisse tout membre ecrire dans les autres fils', () => {
    expect(peutEcrire({ type: 'equipe' }, 'parent')).toBe(true);
    expect(peutEcrire({ type: 'direct' }, 'joueur')).toBe(true);
  });

  it('refuse un non-membre', () => {
    expect(peutEcrire({ type: 'groupe' }, null)).toBe(false);
  });
});

describe('grouperMessagesParJour', () => {
  it('separe les journees dans l ordre chronologique', () => {
    const groupes = grouperMessagesParJour([
      { created_at: '2026-09-08T09:00:00Z' },
      { created_at: '2026-09-08T18:00:00Z' },
      { created_at: '2026-09-09T08:00:00Z' },
    ]);
    expect(groupes.map((g) => [g.jour, g.messages.length])).toEqual([
      ['2026-09-08', 2],
      ['2026-09-09', 1],
    ]);
  });
});
