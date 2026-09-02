import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useClub } from '@/hooks/useClub';
import { useMesVotes, useSondages, useVoter, type SondageAvecOptions } from '@/hooks/useSondages';
import { depouiller, mesChoix, selectionValide, sondageOuvert } from '@/lib/polls';
import { formatDateHeure } from '@/lib/dates';
import type { PollVoteRow } from '@/integrations/supabase/types';
import { Badge, Button, Card, EmptyState, PageTitre, Spinner } from '@/components/ui/primitives';

export default function SondagesPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const { data: club } = useClub(slug);
  const { data: sondages, isLoading } = useSondages(club?.id);
  const { data: votes } = useMesVotes(club?.id, user?.id);

  if (isLoading) return <Spinner />;

  if (!sondages || sondages.length === 0) {
    return (
      <>
        <PageTitre titre="Sondages" />
        <EmptyState
          titre="Aucun sondage en cours"
          description="Covoiturage, tournoi de fin de saison, commande de maillots : le club vous consultera ici."
        />
      </>
    );
  }

  return (
    <>
      <PageTitre titre="Sondages" sousTitre="Votre reponse aide le club a s'organiser" />
      <div className="flex flex-col gap-3">
        {sondages.map((sondage) => (
          <CarteSondage
            key={sondage.id}
            sondage={sondage}
            votes={votes ?? []}
            clubId={club?.id ?? ''}
            userId={user?.id ?? ''}
          />
        ))}
      </div>
    </>
  );
}

function CarteSondage({
  sondage,
  votes,
  clubId,
  userId,
}: {
  sondage: SondageAvecOptions;
  votes: PollVoteRow[];
  clubId: string;
  userId: string;
}) {
  const voter = useVoter(clubId, userId);
  const votesDuSondage = useMemo(
    () => votes.filter((v) => v.poll_id === sondage.id),
    [votes, sondage.id],
  );
  const dejaChoisi = mesChoix(votesDuSondage, userId);
  const [selection, setSelection] = useState<string[]>(dejaChoisi);

  const ouvert = sondageOuvert(sondage);
  const { resultats, total } = depouiller(sondage.poll_options, votesDuSondage);

  const basculer = (optionId: string) => {
    setSelection((actuelle) => {
      if (sondage.choix_multiple) {
        return actuelle.includes(optionId)
          ? actuelle.filter((id) => id !== optionId)
          : [...actuelle, optionId];
      }
      return [optionId];
    });
  };

  const envoyer = () => {
    if (!selectionValide(sondage, selection)) {
      toast.error('Choisissez au moins une option');
      return;
    }
    voter.mutate(
      { pollId: sondage.id, optionIds: selection },
      {
        onSuccess: () => toast.success('Vote enregistre'),
        onError: (erreur) => toast.error(erreur.message),
      },
    );
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">{sondage.question}</p>
          {sondage.description && (
            <p className="mt-1 text-sm text-slate-500">{sondage.description}</p>
          )}
        </div>
        <Badge ton={ouvert ? 'vert' : 'neutre'}>{ouvert ? 'Ouvert' : 'Clos'}</Badge>
      </div>

      <div className="flex flex-col gap-2">
        {sondage.poll_options.map((option) => {
          const resultat = resultats.find((r) => r.optionId === option.id);
          const choisi = selection.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              disabled={!ouvert || voter.isPending}
              onClick={() => basculer(option.id)}
              className={`relative overflow-hidden rounded-lg border px-3 py-2 text-left text-sm ${
                choisi ? 'border-club-600 bg-club-50' : 'border-slate-200 bg-white'
              } disabled:cursor-not-allowed`}
            >
              {/* Barre de resultat en fond : lisible sans quitter la liste. */}
              <span
                className="absolute inset-y-0 left-0 bg-club-100"
                style={{ width: `${resultat?.pourcentage ?? 0}%` }}
                aria-hidden
              />
              <span className="relative flex justify-between gap-2">
                <span>{option.label}</span>
                <span className="text-xs text-slate-500">
                  {resultat?.votes ?? 0} · {resultat?.pourcentage ?? 0} %
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {total} vote{total > 1 ? 's' : ''}
          {sondage.closes_at && ` · cloture le ${formatDateHeure(sondage.closes_at)}`}
          {sondage.anonyme && ' · anonyme'}
        </p>
        {ouvert && (
          <Button onClick={envoyer} disabled={voter.isPending}>
            {dejaChoisi.length > 0 ? 'Modifier mon vote' : 'Voter'}
          </Button>
        )}
      </div>
    </Card>
  );
}
