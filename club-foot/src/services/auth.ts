import { supabase } from '@/integrations/supabase/client';
import type { Session, User } from '@supabase/supabase-js';

/**
 * Metadonnees passees au signup. Elles sont lues par le trigger
 * handle_new_user() cote Postgres, qui cree users + profiles + club_members.
 * C'est le meme contrat que Schproutz (invitation_id / establishment_id).
 */
export interface SignUpMetadata {
  prenom?: string;
  nom?: string;
  telephone?: string;
  invitation_id?: string;
  club_id?: string;
  role?: string;
}

export async function getCurrentUser(): Promise<User | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    console.error("Erreur lors de la recuperation de l'utilisateur:", error);
    return null;
  }

  return user;
}

export async function getCurrentSession(): Promise<Session | null> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    console.error('Erreur lors de la recuperation de la session:', error);
    return null;
  }

  return session;
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<{ user: User; session: Session }> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) throw new Error(error.message);
  if (!data.user || !data.session) throw new Error('Erreur lors de la connexion');

  return { user: data.user, session: data.session };
}

export async function signUpWithEmail(
  email: string,
  password: string,
  metadata?: SignUpMetadata,
): Promise<{ user: User | null; session: Session | null }> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: metadata },
  });

  if (error) throw new Error(error.message);

  return { user: data.user, session: data.session };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function resetPassword(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/login`,
  });
  if (error) throw new Error(error.message);
}

/**
 * Rattache l'utilisateur connecte a un club via le jeton d'invitation.
 * Filet de securite quand le compte existait DEJA au moment de l'invitation :
 * le trigger de signup n'a alors rien eu a rattacher.
 */
export async function acceptInvitation(token: string) {
  const { data, error } = await supabase.rpc('accept_club_invitation', { p_token: token });
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

export function onAuthStateChange(callback: (session: Session | null) => void) {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => callback(session));

  return subscription;
}
