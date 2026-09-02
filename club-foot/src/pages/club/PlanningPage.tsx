import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { MapPin, Clock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useClub, useMesJoueurs } from '@/hooks/useClub';
import { useClubAccess } from '@/hooks/useClubAccess';
import { useEvents, useMesReponses, useRepondreConvocation } from '@/hooks/usePlanning';
import { canManagePlanning } from '@/lib/access';
import {
  grouperParJour,
  presenceLabel,
  reponseAttendue,
  separerEvenements,
  titreEvenement,
  typeLabel,
} from '@/lib/events';
import { formatHeure, formatJourLong } from '@/lib/dates';
import type { AttendanceStatus, EventRow, EventResponseRow } from '@/integrations/supabase/types';
import { Badge, Button, Card, EmptyState, PageTitre, Spinner } from '@/components/ui/primitives';

const REPONSES: { status: AttendanceStatus; label: string }[] = [
  { status: 'present', label: 'Present' },
  { status: 'incertain', label: 'Peut-etre' },
  { status: 'absent', label: 'Absent' },
];

export default function PlanningPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const { data: club } = useClub(slug);
  const { role } = useClubAccess(slug, user?.id);
  const { data: events, isLoading } = useEvents(club?.id);
  const { data: reponses } = useMesReponses(club?.id, user?.id);
  const { data: mesJoueurs } = useMesJoueurs(club?.id, user?.id);
  const repondre = useRepondreConvocation(club?.id ?? '', user?.id ?? '');
  const [onglet, setOnglet] = useState<'a-venir' | 'passes'>('a-venir');

  const { aVenir, passes } = useMemo(
    () => separerEvenements(events ?? []),
    [events],
  );

  const reponsesParEvenement = useMemo(() => {
    const index = new Map<string, EventResponseRow[]>();
    for (const reponse of reponses ?? []) {
      const liste = index.get(reponse.event_id);
      if (liste) liste.push(reponse);
      else index.set(reponse.event_id, [reponse]);
    }
    return index;
  }, [reponses]);

  const nomJoueur = useMemo(() => {
    const index = new Map<string, string>();
    for (const joueur of mesJoueurs ?? []) index.set(joueur.id, joueur.prenom);
    return index;
  }, [mesJoueurs]);

  if (isLoading) return <Spinner />;

  const liste = onglet === 'a-venir' ? aVenir : passes;
  const groupes = grouperParJour(liste);

  const changerReponse = (responseId: string, status: AttendanceStatus) => {
    repondre.mutate(
      { responseId, status },
      {
        onSuccess: () => toast.success(`Reponse enregistree : ${presenceLabel(status)}`),
        onError: (erreur) => toast.error(erreur.message),
      },
    );
  };

  return (
    <>
      <PageTitre
        titre="Planning"
        sousTitre={
          canManagePlanning(role)
            ? 'Entrainements, matchs et convocations de vos equipes'
            : 'Les rendez-vous de vos licencies'
        }
      />

      <div className="mb-4 flex gap-2">
        {(['a-venir', 'passes'] as const).map((valeur) => (
          <Button
            key={valeur}
            variante={onglet === valeur ? 'primaire' : 'secondaire'}
            onClick={() => setOnglet(valeur)}
          >
            {valeur === 'a-venir' ? 'A venir' : 'Passes'}
          </Button>
        ))}
      </div>

      {groupes.length === 0 && (
        <EmptyState
          titre={onglet === 'a-venir' ? 'Rien de prevu pour le moment' : 'Aucun evenement passe'}
          description={
            canManagePlanning(role)
              ? 'Creez un entrainement ou un match pour convoquer votre equipe.'
              : "Le club publiera ici les entrainements et les matchs."
          }
        />
      )}

      <div className="flex flex-col gap-6">
        {groupes.map(({ jour, events: duJour }) => (
          <section key={jour}>
            <h2 className="mb-2 text-sm font-medium text-slate-500 first-letter:uppercase">
              {formatJourLong(duJour[0].starts_at)}
            </h2>
            <div className="flex flex-col gap-2">
              {duJour.map((event: EventRow) => {
                const mesConvocations = reponsesParEvenement.get(event.id) ?? [];
                return (
                  <Card key={event.id} className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900">{titreEvenement(event)}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {event.rdv_at
                              ? `RDV ${formatHeure(event.rdv_at)} · coup d'envoi ${formatHeure(event.starts_at)}`
                              : formatHeure(event.starts_at)}
                          </span>
                          {event.lieu && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              {event.lieu}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge ton={event.type === 'match' ? 'vert' : 'neutre'}>
                          {typeLabel(event.type)}
                        </Badge>
                        {event.status === 'brouillon' && <Badge ton="ambre">Brouillon</Badge>}
                        {event.status === 'annule' && <Badge ton="rouge">Annule</Badge>}
                      </div>
                    </div>

                    {mesConvocations.map((convocation) => (
                      <div
                        key={convocation.id}
                        className="rounded-lg bg-slate-50 p-2"
                      >
                        <p className="mb-2 text-xs font-medium text-slate-600">
                          {nomJoueur.get(convocation.player_id) ?? 'Convocation'}
                          {reponseAttendue(event, convocation) && (
                            <span className="ml-2 text-amber-700">reponse attendue</span>
                          )}
                        </p>
                        <div className="flex gap-2">
                          {REPONSES.map(({ status, label }) => (
                            <Button
                              key={status}
                              variante={convocation.status === status ? 'primaire' : 'secondaire'}
                              disabled={repondre.isPending || event.status !== 'publie'}
                              onClick={() => changerReponse(convocation.id, status)}
                            >
                              {label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
