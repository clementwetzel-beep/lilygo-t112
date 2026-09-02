import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import {
  getCurrentSession,
  getCurrentUser,
  onAuthStateChange,
  signInWithEmail,
  signOut,
  signUpWithEmail,
  type SignUpMetadata,
} from '@/services/auth';

export const authKeys = {
  all: ['auth'] as const,
  user: () => [...authKeys.all, 'user'] as const,
  session: () => [...authKeys.all, 'session'] as const,
};

/** Session courante + abonnement aux changements (login, logout, refresh). */
export function useAuth() {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentSession().then((sess) => {
      setSession(sess);
      setLoading(false);
    });

    const subscription = onAuthStateChange((sess) => {
      setSession(sess);
      // Tout ce qui depend de l'identite (acces club, joueurs, fils de
      // discussion) doit etre recalcule apres un changement de session.
      queryClient.invalidateQueries();
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  return { session, loading, user: session?.user ?? null };
}

export function useCurrentUser() {
  return useQuery({
    queryKey: authKeys.user(),
    queryFn: getCurrentUser,
    staleTime: 1000 * 60 * 5,
  });
}

export function useSignIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      signInWithEmail(email, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.all });
    },
  });
}

export function useSignUp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      email,
      password,
      metadata,
    }: {
      email: string;
      password: string;
      metadata?: SignUpMetadata;
    }) => signUpWithEmail(email, password, metadata),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.all });
    },
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: signOut,
    onSuccess: () => queryClient.clear(),
  });
}
