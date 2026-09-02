import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useClub, useMesJoueurs } from '@/hooks/useClub';
import { useClubAccess } from '@/hooks/useClubAccess';
import { useEvents, useMesReponses } from '@/hooks/usePlanning';
import { useSondages } from '@/hooks/useSondages';
import { useSituationAdministrative } from '@/hooks/useAdministratif';
import { useNonLus } from '@/hooks/useMessagerie';
import { canManageAdministratif, roleLabel } from '@/lib/access';
import { reponseAttendue, separerEvenements, titreEvenement } from '@/lib/events';
import { sondageOuvert } from '@/lib/polls';
import { messageSituation, resumeSituation } from '@/lib/administratif';
import { totalNonLus } from '@/lib/messaging';
import { formatDateHeure } from '@/lib/dates';
import { Badge, Card, PageTitre, Spinner } from '@/components/ui/primitives';

/**
 * Tableau de bord : ce qui reclame une action, d'abord. Un parent doit voir en
 * dix secondes s'il doit repondre a une convocation ou fournir une piece.
 */
export default function AccueilPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const { data: club, isLoading } = useClub(slug);
  const { role } = useClubAccess(slug, user?.id);
  const { data: events } = useEvents(club?.id);
  const { data: reponses } = useMesReponses(club?.id, user?.id);
  const { data: mesJoueurs } = useMesJoueurs(club?.id, user?.id);
  const { data: sondages } = useSondages(club?.id);
  const { data: situation } = useSituationAdministrative(club?.id);
  const { data: compteurs } = useNonLus(club?.id);

  const { aVenir } = useMemo(() => separerEvenements(events ?? []), [events]);
  const prochain = aVenir.find((event) => event.status === 'publie') ?? null;

  const convocationsEnAttente = useMemo(() => {
    if (!events || !reponses) return 0;
    const parId = new Map(events.map((event) => [event.id, event]));
    return reponses.filter((reponse) => {
      const event = parId.get(reponse.event_id);
      return event ? reponseAttendue(event, reponse) : false;
    }).length;
  }, [events, reponses]);

  const sondagesOuverts = (sondages ?? []).filter((sondage) => sondageOuvert(sondage)).length;
  const nonLus = totalNonLus(compteurs ?? []);
  const resume = resumeSituation(situation ?? []);
  const dossiersIncomplets = (situation ?? []).filter((ligne) => !ligne.en_regle);

  if (isLoading) return <Spinner />;

  return (
    <>
      <PageTitre
        titre={`Bonjour${mesJoueurs?.length ? '' : ''} !`}
        sousTitre={`${club?.name ?? ''} · ${roleLabel(role)}`}
      />

      <div className="mb-4 grid grid-cols-3 gap-2">
        <Vignette
          to={`/club/${slug}/planning`}
          valeur={convocationsEnAttente}
          libelle="convocation(s) sans reponse"
          alerte={convocationsEnAttente > 0}
        />
        <Vignette
          to={`/club/${slug}/sondages`}
          valeur={sondagesOuverts}
          libelle="sondage(s) ouvert(s)"
        />
        <Vignette to={`/club/${slug}/messages`} valeur={nonLus} libelle="message(s) non lu(s)" />
      </div>

      {prochain && (
        <Card className="mb-4">
          <p className="text-xs font-medium text-slate-500">Prochain rendez-vous</p>
          <p className="mt-1 font-medium text-slate-900">{titreEvenement(prochain)}</p>
          <p className="text-sm text-slate-500">
            {formatDateHeure(prochain.rdv_at ?? prochain.starts_at)}
            {prochain.lieu && ` · ${prochain.lieu}`}
          </p>
          <Link
            to={`/club/${slug}/planning`}
            className="mt-2 inline-block text-sm font-medium text-club-700 hover:underline"
          >
            Voir le planning
          </Link>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-500">Situation administrative</p>
          {canManageAdministratif(role) && (
            <Badge ton={resume.tauxConformite === 100 ? 'vert' : 'ambre'}>
              {resume.enRegle}/{resume.joueurs} en regle
            </Badge>
          )}
        </div>

        {dossiersIncomplets.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">Tout est a jour. Bonne saison !</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {dossiersIncomplets.slice(0, 4).map((ligne) => (
              <li key={ligne.player_id} className="flex justify-between gap-2 text-sm">
                <span className="text-slate-700">
                  {ligne.prenom} {ligne.nom}
                </span>
                <span className="text-slate-500">{messageSituation(ligne)}</span>
              </li>
            ))}
          </ul>
        )}

        <Link
          to={`/club/${slug}/administratif`}
          className="mt-2 inline-block text-sm font-medium text-club-700 hover:underline"
        >
          Ouvrir le dossier
        </Link>
      </Card>
    </>
  );
}

function Vignette({
  to,
  valeur,
  libelle,
  alerte = false,
}: {
  to: string;
  valeur: number;
  libelle: string;
  alerte?: boolean;
}) {
  return (
    <Link to={to}>
      <Card className="h-full text-center">
        <p className={`text-2xl font-semibold ${alerte ? 'text-red-600' : 'text-slate-900'}`}>
          {valeur}
        </p>
        <p className="text-[11px] leading-tight text-slate-500">{libelle}</p>
      </Card>
    </Link>
  );
}
