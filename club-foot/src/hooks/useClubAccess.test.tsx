import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@/test/test-utils';
import { useClubAccess } from './useClubAccess';

// Le hook interroge le club ET les adhesions EN PARALLELE, puis rapproche en
// memoire. Ces tests verrouillent le verdict d'acces : un faux positif
// ouvrirait le back-office d'un club a n'importe quel licencie.
type Row = Record<string, unknown>;

let clubRow: { data: Row | null; error: unknown };
let membershipRows: { data: Row[] | null; error: unknown };
let tablesInterrogees: string[] = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      tablesInterrogees.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: () => Promise.resolve(clubRow),
        // Sans .single(), la requete est directement awaitable.
        then: (resolve: (v: unknown) => unknown) => resolve(membershipRows),
      };
      return builder;
    },
  },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>
);

const run = async (
  slug = 'us-rombas',
  userId = 'user-1',
  requiredRoles?: Parameters<typeof useClubAccess>[2],
) => {
  const { result } = renderHook(() => useClubAccess(slug, userId, requiredRoles), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return result;
};

describe('useClubAccess', () => {
  beforeEach(() => {
    tablesInterrogees = [];
    clubRow = { data: { id: 'club-1', owner_id: 'quelqu-un-dautre' }, error: null };
    membershipRows = { data: [], error: null };
  });

  it('accorde le role owner au president du club', async () => {
    clubRow = { data: { id: 'club-1', owner_id: 'user-1' }, error: null };
    const result = await run();
    expect(result.current).toMatchObject({ hasAccess: true, role: 'owner', clubId: 'club-1' });
  });

  it('accorde l acces a un parent membre', async () => {
    membershipRows = { data: [{ club_id: 'club-1', role: 'parent' }], error: null };
    const result = await run();
    expect(result.current).toMatchObject({ hasAccess: true, role: 'parent' });
  });

  it('interroge le club et les adhesions dans le meme temps', async () => {
    await run();
    expect(tablesInterrogees).toEqual(['clubs', 'club_members']);
  });

  it('refuse quand l adhesion porte sur un autre club', async () => {
    membershipRows = { data: [{ club_id: 'club-2', role: 'dirigeant' }], error: null };
    const result = await run();
    expect(result.current).toMatchObject({ hasAccess: false, role: null, clubId: 'club-1' });
  });

  it('refuse quand le slug est inconnu', async () => {
    clubRow = { data: null, error: { message: 'not found' } };
    const result = await run('club-fantome');
    expect(result.current).toMatchObject({ hasAccess: false, role: null, clubId: null });
  });

  it('refuse un parent sur une route reservee au bureau, sans perdre son role', async () => {
    membershipRows = { data: [{ club_id: 'club-1', role: 'parent' }], error: null };
    const result = await run('us-rombas', 'user-1', ['owner', 'dirigeant']);
    expect(result.current).toMatchObject({ hasAccess: false, role: 'parent' });
  });

  it('ne lance aucune requete sans utilisateur connecte', () => {
    const { result } = renderHook(() => useClubAccess('us-rombas', undefined), { wrapper });
    expect(tablesInterrogees).toEqual([]);
    expect(result.current.hasAccess).toBe(false);
  });
});
