import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useSignIn, useSignUp } from '@/hooks/useAuth';
import { acceptInvitation } from '@/services/auth';
import { Button, Card } from '@/components/ui/primitives';

type Mode = 'connexion' | 'inscription';

/**
 * Une invitation arrive par un lien du type :
 *   /login?invitation=<id>&club=<club_id>&role=parent&token=<token>&email=...
 * Les trois premiers champs sont recopies dans les metadonnees du signup :
 * c'est le trigger handle_new_user() qui cree l'adhesion au club. Le token
 * sert au rattrapage quand le compte existait deja (accept_club_invitation).
 */
export default function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const signIn = useSignIn();
  const signUp = useSignUp();

  const invitationId = params.get('invitation');
  const clubId = params.get('club');
  const roleInvite = params.get('role');
  const token = params.get('token');

  const [mode, setMode] = useState<Mode>(invitationId ? 'inscription' : 'connexion');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');

  const enCours = signIn.isPending || signUp.isPending;

  const rattacherSiInvitation = async () => {
    if (!token) return;
    try {
      await acceptInvitation(token);
    } catch (erreur) {
      // Le compte est cree/connecte : on n'echoue pas la connexion pour autant,
      // on signale juste que le rattachement au club n'a pas pris.
      toast.error(erreur instanceof Error ? erreur.message : 'Invitation non rattachee');
    }
  };

  const soumettre = async (event: FormEvent) => {
    event.preventDefault();

    try {
      if (mode === 'connexion') {
        await signIn.mutateAsync({ email, password });
        await rattacherSiInvitation();
        toast.success('Bon retour !');
      } else {
        await signUp.mutateAsync({
          email,
          password,
          metadata: {
            prenom,
            nom,
            ...(invitationId && clubId
              ? { invitation_id: invitationId, club_id: clubId, role: roleInvite ?? 'joueur' }
              : {}),
          },
        });
        toast.success('Compte cree. Bienvenue au club !');
      }
      navigate('/');
    } catch (erreur) {
      toast.error(erreur instanceof Error ? erreur.message : 'Connexion impossible');
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-slate-900">Onze</h1>
        <p className="mb-4 text-sm text-slate-500">
          {invitationId
            ? 'Vous avez ete invite a rejoindre un club.'
            : 'Le planning, les sondages et le dossier de vos licencies.'}
        </p>

        <form onSubmit={soumettre} className="flex flex-col gap-3">
          {mode === 'inscription' && (
            <div className="flex gap-2">
              <input
                className="w-1/2 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Prenom"
                value={prenom}
                onChange={(e) => setPrenom(e.target.value)}
                autoComplete="given-name"
              />
              <input
                className="w-1/2 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Nom"
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                autoComplete="family-name"
              />
            </div>
          )}

          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            type="email"
            required
            placeholder="Adresse email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            type="password"
            required
            minLength={8}
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'connexion' ? 'current-password' : 'new-password'}
          />

          <Button type="submit" disabled={enCours}>
            {enCours ? 'Un instant…' : mode === 'connexion' ? 'Se connecter' : 'Creer mon compte'}
          </Button>
        </form>

        <button
          type="button"
          className="mt-4 w-full text-center text-sm text-club-700 hover:underline"
          onClick={() => setMode(mode === 'connexion' ? 'inscription' : 'connexion')}
        >
          {mode === 'connexion' ? "Je n'ai pas encore de compte" : "J'ai deja un compte"}
        </button>

        <p className="mt-4 text-center text-xs text-slate-400">
          <Link to="/">Retour</Link>
        </p>
      </Card>
    </div>
  );
}
